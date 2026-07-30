import fs from "node:fs";
import path from "node:path";
import { normalizeSpec, providerBase, resolveAdapter, isMockSpec } from "./adapters/registry.js";
import { buildCharter, PERSPECTIVE_TEMPLATES } from "./engine/charter.js";
import { buildContextMaterial, CONTEXT_MAX_BYTES } from "./engine/context.js";
import { runTopic } from "./engine/runner.js";
import { appendInbox } from "./store/inbox.js";
import { readLock, pidAlive } from "./store/lock.js";
import { resolveTopicsRoot, topicDir } from "./store/paths.js";
import {
  createTopic,
  listTopics,
  loadTopic,
  saveTopic,
  transition,
  type Participant,
  type Topic,
  type TopicMode,
} from "./store/topic.js";
import { readTranscript, watchTranscript, TRANSCRIPT_FILE, type TranscriptEvent } from "./store/transcript.js";

export type Flags = Record<string, string | boolean>;

/** 极简 flag 解析:--k v / --k(布尔) / 其余为位置参数 */
export function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function slugify(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || "topic";
}

function uniqueId(root: string, base: string): string {
  const date = new Date().toISOString().slice(0, 10);
  let id = `${date}-${base}`;
  let n = 2;
  while (fs.existsSync(path.join(root, id))) id = `${date}-${base}-${n++}`;
  return id;
}

function csv(value: string | boolean | undefined): string[] {
  return typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** --timeout <秒> → ms;缺省 undefined(用 runner 默认);非法返回 null(调用方报错中止) */
function parseTimeoutMs(flags: Flags): number | null | undefined {
  if (flags.timeout === undefined) return undefined;
  const sec = typeof flags.timeout === "string" ? Number(flags.timeout) : NaN;
  if (!Number.isInteger(sec) || sec < 1) return null;
  return sec * 1000;
}

function printEvent(event: TranscriptEvent): void {
  const round = event.round > 0 ? `[R${event.round}] ` : "";
  if (event.kind === "message") console.log(`${round}${event.from}: ${event.body}`);
  else if (event.kind === "human") console.log(`${round}${event.from}(插话): ${event.body}`);
  else if (event.kind === "skip") console.log(`${round}${event.from}: 【跳过】`);
  else if (event.kind === "verdict") console.log(`${round}${event.from}(裁决): ${event.body}`);
  else if (event.kind === "error") console.log(`${round}⚠ ${event.from ?? ""} 失败: ${event.body}`);
  else if (event.kind === "round_end") console.log(`${round}—— 本轮结束 ——`);
  else if (event.kind === "system") console.log(`* ${event.body}`);
}

export interface CmdContext {
  root?: string;
}

export async function cmdNew(positional: string[], flags: Flags, ctx: CmdContext = {}): Promise<number> {
  const root = ctx.root ?? resolveTopicsRoot();
  const title = positional[0];
  if (!title) {
    console.error('用法: roundtable new "<话题>" --providers <a,b,...> [--perspectives ...] [--mode roundtable] [--max-rounds 3] [--model ...] [--context-file a,b] [--context-dir <dir> [--context-glob "*.ts"]] [--repo <代码仓库>] [--timeout <秒>]');
    return 1;
  }
  const specs = csv(flags.providers);
  if (specs.length < 2) {
    console.error("--providers 至少需要 2 个参与者(逗号分隔;支持 claude/codex/opencode/reasonix 或 mock:<脚本>)");
    return 1;
  }
  const mode = (typeof flags.mode === "string" ? flags.mode : "roundtable") as TopicMode;
  if (mode !== "roundtable" && mode !== "debate") {
    console.error(`--mode 仅支持 roundtable | debate,收到: ${mode}`);
    return 1;
  }
  const maxRounds = typeof flags["max-rounds"] === "string" ? Number(flags["max-rounds"]) : 3;
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    console.error(`--max-rounds 需为正整数,收到: ${String(flags["max-rounds"])}`);
    return 1;
  }
  const model = typeof flags.model === "string" ? flags.model : undefined;
  const timeoutMs = parseTimeoutMs(flags);
  if (timeoutMs === null) {
    console.error(`--timeout 需为正整数秒,收到: ${String(flags.timeout)}`);
    return 1;
  }
  const perspectives = csv(flags.perspectives);
  const templateIds = Object.keys(PERSPECTIVE_TEMPLATES);

  // 规范化 provider spec(mock 相对路径转绝对),真实 provider 校验可用性
  const normalized = specs.map((s) => normalizeSpec(s, process.cwd()));
  for (const spec of normalized) {
    if (isMockSpec(spec)) continue;
    const detection = await resolveAdapter(spec).detect();
    if (!detection.ok) {
      console.error(`provider ${providerBase(spec)} 不可用(roundtable doctor 可排查),开题中止`);
      return 1;
    }
  }

  const baseCounts = new Map<string, number>();
  const participants = normalized.map((spec, i) => {
    const base = providerBase(spec);
    const n = (baseCounts.get(base) ?? 0) + 1;
    baseCounts.set(base, n);
    const perspective = perspectives[i] ?? templateIds[i % templateIds.length]!;
    return { handle: `${base}-${n}`, provider: spec, perspective, model };
  });

  // 注入参考材料(R1):读文件失败直接中止开题
  let contextMaterial: string | undefined;
  const hasContextFlags =
    typeof flags["context-file"] === "string" || typeof flags["context-dir"] === "string";
  if (hasContextFlags) {
    const ctx = buildContextMaterial({
      files: csv(flags["context-file"]),
      dir: typeof flags["context-dir"] === "string" ? flags["context-dir"] : undefined,
      glob: typeof flags["context-glob"] === "string" ? flags["context-glob"] : undefined,
      cwd: process.cwd(),
    });
    contextMaterial = ctx.material || undefined;
    if (ctx.entries.length > 0) {
      const kb = (ctx.totalBytes / 1024).toFixed(1);
      console.log(`注入参考材料 ${ctx.entries.length} 个文件,共 ${kb} KB:`);
      for (const e of ctx.entries) console.log(`  - ${e.label}(${(e.bytes / 1024).toFixed(1)} KB)`);
      if (ctx.overLimit) {
        console.error(`⚠ 参考材料超过 ${(CONTEXT_MAX_BYTES / 1024).toFixed(0)} KB 建议上限,将显著增加每轮 token(charter 每轮随 prompt 重发)`);
      }
    }
    if (ctx.skipped.length > 0) {
      console.error(`⚠ 跳过 ${ctx.skipped.length} 个二进制文件(未注入): ${ctx.skipped.join(", ")}`);
    }
  }

  // 自读(R2):--repo 指向代码仓库,发言时子进程 cwd 指向它并开只读
  let repo: string | undefined;
  if (typeof flags.repo === "string") {
    repo = path.resolve(flags.repo);
    if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
      console.error(`--repo 不存在或不是目录: ${flags.repo}`);
      return 1;
    }
    console.log(`自读模式:参与者可在只读下检索代码仓库 ${repo}`);
    console.error("⚠ 自读为实验特性:claude/codex 只读已核准,opencode/reasonix 依赖各自默认只读(未深度加固);仓库文件与记录均按「数据非指令」声明处理,但自读绕过注入侧围栏,仅降低指令混淆而非安全隔离。");
  }

  const id = uniqueId(root, slugify(title));
  const topic = createTopic(root, { id, title, mode, maxRounds, participants, repo });
  const dir = topicDir(root, id);
  fs.writeFileSync(
    path.join(dir, "charter.md"),
    buildCharter({
      title,
      mode,
      maxRounds,
      participants: topic.participants.map((p) => ({
        handle: p.handle,
        providerBase: providerBase(p.provider),
        perspective: p.perspective,
      })),
      contextMaterial,
      // F4②:无 --repo 时 cwd=话题目录 → 相对路径可读;有 --repo 时给绝对路径(best-effort)
      transcriptRef: repo ? path.join(dir, TRANSCRIPT_FILE) : `./${TRANSCRIPT_FILE}`,
      selfRead: !!repo, // F11:自读开启时加数据非指令声明
    }),
  );

  console.log(`已开题: ${id}(${participants.length} 位参与者,${mode},最多 ${maxRounds} 轮)`);
  console.log("前台运行中,Ctrl+C 可在当前发言完成后优雅暂停\n");
  const final = await runTopic(dir, { onEvent: (e) => printEvent(e), ...(timeoutMs ? { timeoutMs } : {}) });
  console.log(`\n话题状态: ${final.status}`);
  return 0;
}

export async function cmdContinue(positional: string[], flags: Flags, ctx: CmdContext = {}): Promise<number> {
  const root = ctx.root ?? resolveTopicsRoot();
  const id = positional[0];
  if (!id) {
    console.error('用法: roundtable continue <topic> [--ask "<追问>"] [--more <n>] [--as <名字>] [--timeout <秒>]');
    return 1;
  }
  const dir = topicDir(root, id);
  if (!fs.existsSync(path.join(dir, "topic.json"))) {
    console.error(`话题不存在: ${id}`);
    return 1;
  }
  const timeoutMs = parseTimeoutMs(flags);
  if (timeoutMs === null) {
    console.error(`--timeout 需为正整数秒,收到: ${String(flags.timeout)}`);
    return 1;
  }
  let topic = loadTopic(dir);
  if (topic.status === "completed") {
    // 续谈(方案 B):重开已完成话题 —— 加轮 + 翻回 active,追问经 inbox 落为 human 事件
    if (flags.ask === true) {
      console.error('--ask 需要追问内容,如: --ask "针对X再深入"');
      return 1;
    }
    const ask = typeof flags.ask === "string" ? flags.ask : undefined;
    if (ask === undefined && flags.more === undefined) {
      console.error(`话题已完成: ${id}。如需继续深入,用 continue <topic> --ask "<追问>" [--more <n>] 重开`);
      return 1;
    }
    const addRounds = typeof flags.more === "string" ? Number(flags.more) : 1;
    if (!Number.isInteger(addRounds) || addRounds < 1) {
      console.error(`--more 需为正整数,收到: ${String(flags.more)}`);
      return 1;
    }
    // F9:重开水位线——resumeFromSeq 置为当时 lastSeq,currentRound 推到最大轮号(过裁决轮),
    // maxRounds 相对新起点加轮,避免新交锋与旧裁决同号 + 挡旧裁决回流。
    const events = readTranscript(dir);
    const lastSeq = events.at(-1)?.seq ?? 0;
    const maxRound = events.reduce((m, e) => Math.max(m, e.round), 0);
    topic = transition(
      { ...topic, currentRound: maxRound, maxRounds: maxRound + addRounds, resumeFromSeq: lastSeq },
      "active",
    );
    saveTopic(dir, topic);
    if (ask !== undefined) {
      const from = typeof flags.as === "string" ? flags.as : "user";
      appendInbox(dir, { kind: "say", from, body: ask });
      console.log(`重开已完成话题: ${id}(+${addRounds} 轮,追问已注入)\n`);
    } else {
      console.log(`重开已完成话题: ${id}(+${addRounds} 轮)\n`);
    }
  } else {
    console.log(`继续话题: ${id}(已完成 ${topic.currentRound}/${topic.maxRounds} 轮)\n`);
  }
  const final = await runTopic(dir, { onEvent: (e) => printEvent(e), ...(timeoutMs ? { timeoutMs } : {}) });
  console.log(`\n话题状态: ${final.status}`);
  return 0;
}

export function cmdStop(positional: string[], _flags: Flags, ctx: CmdContext = {}): number {
  const root = ctx.root ?? resolveTopicsRoot();
  const id = positional[0];
  if (!id) {
    console.error("用法: roundtable stop <topic>");
    return 1;
  }
  const dir = topicDir(root, id);
  if (!fs.existsSync(path.join(dir, "topic.json"))) {
    console.error(`话题不存在: ${id}`);
    return 1;
  }
  const lock = readLock(dir);
  if (lock && pidAlive(lock.pid)) {
    // runner 在跑:写 inbox stop 控制事件,runner 在安全边界收尾(design §5)
    appendInbox(dir, { kind: "stop", from: "cli" });
    console.log(`已向运行中的 runner 发送停止请求: ${id}`);
    return 0;
  }
  // 无 runner:直接置完成态
  const topic = loadTopic(dir);
  if (topic.status === "completed") {
    console.log(`话题已是完成态: ${id}`);
    return 0;
  }
  saveTopic(dir, transition(topic, "completed"));
  console.log(`已结束话题: ${id}`);
  return 0;
}

export interface TopicView {
  id: string;
  title: string;
  mode: TopicMode;
  status: Topic["status"];
  round: { current: number; max: number };
  participants: { handle: string; provider: string; tokens: Participant["tokens"] }[];
}

export function listView(topics: Topic[]): TopicView[] {
  return topics.map((t) => ({
    id: t.id,
    title: t.title,
    mode: t.mode,
    status: t.status,
    round: { current: t.currentRound, max: t.maxRounds },
    participants: t.participants.map((p) => ({
      handle: p.handle,
      provider: providerBase(p.provider),
      tokens: p.tokens,
    })),
  }));
}

export function cmdList(_positional: string[], flags: Flags, ctx: CmdContext = {}): number {
  const root = ctx.root ?? resolveTopicsRoot();
  const views = listView(listTopics(root));
  if (flags.json) {
    console.log(JSON.stringify(views));
    return 0;
  }
  if (views.length === 0) {
    console.log("(暂无话题)");
    return 0;
  }
  for (const v of views) {
    console.log(
      `${v.id.padEnd(28)} ${v.status.padEnd(10)} ${v.mode.padEnd(11)} ${v.round.current}/${v.round.max} 轮  ${v.title}`,
    );
  }
  return 0;
}

export async function cmdAttach(positional: string[], flags: Flags, ctx: CmdContext = {}): Promise<number> {
  const root = ctx.root ?? resolveTopicsRoot();
  const id = positional[0];
  if (!id) {
    console.error("用法: roundtable attach <topic> [--as <名字>]");
    return 1;
  }
  const dir = topicDir(root, id);
  if (!fs.existsSync(path.join(dir, "topic.json"))) {
    console.error(`话题不存在: ${id}`);
    return 1;
  }
  const humanName = typeof flags.as === "string" ? flags.as : "human";
  // 动态载入,避免非 TUI 命令拉起 Ink/React 依赖
  const { runAttach } = await import("./tui/attach.js");
  await runAttach(dir, { humanName });
  return 0;
}

export async function cmdShow(positional: string[], flags: Flags, ctx: CmdContext = {}): Promise<number> {
  const root = ctx.root ?? resolveTopicsRoot();
  const id = positional[0];
  if (!id) {
    console.error("用法: roundtable show <topic> [--follow] [--json]");
    return 1;
  }
  const dir = topicDir(root, id);
  if (!fs.existsSync(path.join(dir, "topic.json"))) {
    console.error(`话题不存在: ${id}`);
    return 1;
  }
  const events = readTranscript(dir);
  if (flags.json) {
    console.log(JSON.stringify(events));
    return 0;
  }
  for (const e of events) printEvent(e);

  if (!flags.follow) return 0;
  // 纯流式 tail:TUI 之前的保底查看/调试通道
  return await new Promise<number>((resolve) => {
    const stop = watchTranscript(dir, (batch) => batch.forEach(printEvent));
    const done = (): void => {
      stop();
      resolve(0);
    };
    process.on("SIGINT", done);
  });
}
