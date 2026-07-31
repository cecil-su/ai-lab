import fs from "node:fs";
import path from "node:path";
import { normalizeSpec, providerBase, resolveAdapter, isMockSpec, adapterResumable, isResumableProvider } from "./adapters/registry.js";
import type { ProviderAdapter } from "./adapters/types.js";
import { buildCharter, PERSPECTIVE_TEMPLATES } from "./engine/charter.js";
import { buildContextMaterial, CONTEXT_MAX_BYTES } from "./engine/context.js";
import { writeFallbackSummary } from "./engine/modes.js";
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

// A5:保留 CJK/字母/数字,仅折叠文件系统不安全字符与空白 → 中文标题也产出可辨认 id;限长 60
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-") // 文件系统不安全字符
    .replace(/\s+/g, "-") // 空白
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, ""); // 截断后可能留尾部 -
  return slug || "topic";
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
  /** 测试/嵌入方可注入 adapter resolver;CLI 缺省使用正式 registry */
  resolveAdapter?: (spec: string) => ProviderAdapter;
}

/**
 * ②:--repo 自读下未强制只读(inherited)的 provider base 列表(mock 除外,去重)。
 * 空 = 全部 enforced(claude/codex),无需 unsafe override;非空 = 需 --allow-unsafe-repo 才放行。
 */
export function inheritedProviders(
  specs: string[],
  resolve: (spec: string) => ProviderAdapter = resolveAdapter,
): string[] {
  return [
    ...new Set(
      specs
        .filter((s) => !isMockSpec(s))
        .filter((s) => resolve(s).capabilities?.codeAccess !== "enforced")
        .map((s) => providerBase(s)),
    ),
  ];
}

export async function cmdNew(positional: string[], flags: Flags, ctx: CmdContext = {}): Promise<number> {
  const root = ctx.root ?? resolveTopicsRoot();
  const adapterResolver = ctx.resolveAdapter ?? resolveAdapter;
  const title = positional[0];
  if (!title) {
    console.error('用法: roundtable new "<话题>" --providers <a,b,...> [--perspectives ...] [--mode roundtable] [--max-rounds 3] [--model ...] [--context-file a,b] [--context-dir <dir> [--context-glob "*.ts"]] [--repo <代码仓库> [--allow-unsafe-repo]] [--timeout <秒>]');
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
    const detection = await adapterResolver(spec).detect();
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
    if (ctx.dropped.length > 0) {
      console.error(`⚠ 硬裁剪 ${ctx.dropped.length} 个超体量上限的文件(未注入): ${ctx.dropped.join(", ")}`);
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
    // ②:capabilities 接策略层 —— inherited(非强制只读)provider + --repo 默认拒绝,须显式 --allow-unsafe-repo 覆盖。
    const inherited = inheritedProviders(normalized, adapterResolver);
    const allowUnsafe = flags["allow-unsafe-repo"] === true;
    if (inherited.length > 0 && !allowUnsafe) {
      console.error(
        `--repo 拒绝:${inherited.join("/")} 未强制只读(依赖各自默认档,自读可能越界写)。` +
          `请移除它们、改用 enforced provider(claude/codex),或加 --allow-unsafe-repo 明确接受风险。`,
      );
      return 1;
    }
    console.log(`自读模式:参与者将直接检索代码仓库 ${repo}`);
    const who = inherited.length > 0
      ? `${inherited.join("/")} 未强制只读(已由 --allow-unsafe-repo 显式放行)`
      : "各家均强制只读";
    // enforced 只保证写权限受限,不保证项目指令/plugin/hook 隔离;所有 --repo 路径都保留实验性披露。
    console.error(`⚠ 自读为实验特性:${who};只读权限不隔离项目指令/plugin/hook。仓库文件与记录虽按「数据非指令」声明,自读仍绕过注入侧围栏,只降低指令混淆,不构成安全隔离。`);
  }

  const id = uniqueId(root, slugify(title));
  // Phase-3 ②:创建时快照各家会话可续性声明,供恢复/续谈决策与 list --json 消费
  const capabilities = Object.fromEntries(
    normalized.map((spec, i) => [
      participants[i]!.handle,
      { resumableSession: adapterResumable(spec, adapterResolver) },
    ]),
  );
  const topic = createTopic(root, { id, title, mode, maxRounds, participants, repo, capabilities });
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
  const final = await runTopic(dir, {
    onEvent: (e) => printEvent(e),
    resolveAdapter: adapterResolver,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  console.log(`\n话题状态: ${final.status}`);
  return 0;
}

export async function cmdContinue(positional: string[], flags: Flags, ctx: CmdContext = {}): Promise<number> {
  const root = ctx.root ?? resolveTopicsRoot();
  const adapterResolver = ctx.resolveAdapter ?? resolveAdapter;
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
  if (topic.status === "completed" || topic.status === "cancelled") {
    const terminalLabel = topic.status === "cancelled" ? "已取消" : "已完成";
    // 续谈(方案 B):重开已完成/已取消话题 —— 加轮 + 翻回 active,追问经 inbox 落为 human 事件
    if (flags.ask === true) {
      console.error('--ask 需要追问内容,如: --ask "针对X再深入"');
      return 1;
    }
    const ask = typeof flags.ask === "string" ? flags.ask : undefined;
    if (ask === undefined && flags.more === undefined) {
      console.error(`话题${terminalLabel}: ${id}。如需继续深入,用 continue <topic> --ask "<追问>" [--more <n>] 重开`);
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
      {
        ...topic,
        outcome: undefined, // 新一代尚无结果,不得把上一代 failed/degraded 带进 active/paused/cancelled
        currentRound: maxRound,
        maxRounds: maxRound + addRounds,
        resumeFromSeq: lastSeq,
      },
      "active",
    );
    saveTopic(dir, topic);
    if (ask !== undefined) {
      const from = typeof flags.as === "string" ? flags.as : "user";
      appendInbox(dir, { kind: "say", from, body: ask });
      console.log(`重开${terminalLabel}话题: ${id}(+${addRounds} 轮,追问已注入)\n`);
    } else {
      console.log(`重开${terminalLabel}话题: ${id}(+${addRounds} 轮)\n`);
    }
  } else {
    console.log(`继续话题: ${id}(已完成 ${topic.currentRound}/${topic.maxRounds} 轮)\n`);
  }
  const final = await runTopic(dir, {
    onEvent: (e) => printEvent(e),
    resolveAdapter: adapterResolver,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
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
  // 无 runner:人工终止 → cancelled(①:与"收尾完成"的 completed 区分)
  const topic = loadTopic(dir);
  if (topic.status === "completed" || topic.status === "cancelled") {
    console.log(`话题已是终态(${topic.status}): ${id}`);
    return 0;
  }
  // #8:置终态前补一份终止说明,维持"终态 ⇒ summary.md 存在"不变量,避免无产物的伪完成。
  // 仅在无正式 summary 时写(已收尾产出的正式结论不覆盖)。
  if (!fs.existsSync(path.join(dir, "summary.md"))) {
    writeFallbackSummary(dir, "经 CLI 人工终止(stop),未运行收尾,无正式结论。");
  }
  saveTopic(dir, { ...transition(topic, "cancelled"), outcome: undefined });
  console.log(`已取消话题: ${id}`);
  return 0;
}

export interface TopicView {
  id: string;
  title: string;
  mode: TopicMode;
  status: Topic["status"];
  /** ①:结果态,与 status 正交;旧 completed 缺省表示 unknown */
  outcome?: Topic["outcome"];
  round: { current: number; max: number };
  participants: {
    handle: string;
    provider: string;
    tokens: Participant["tokens"];
    failures: number;
    /** A1:failures>0 时计量为下界(失败调用的 token 无法计入) */
    tokensLowerBound: boolean;
    /** Phase-3 ②:创建时快照的会话可续性声明 */
    resumableSession: boolean;
  }[];
}

export function listView(topics: Topic[]): TopicView[] {
  return topics.map((t) => ({
    id: t.id,
    title: t.title,
    mode: t.mode,
    status: t.status,
    ...(t.status === "completed" && t.outcome ? { outcome: t.outcome } : {}),
    round: { current: t.currentRound, max: t.maxRounds },
    participants: t.participants.map((p) => ({
      handle: p.handle,
      provider: providerBase(p.provider),
      tokens: p.tokens,
      failures: p.failures,
      tokensLowerBound: p.failures > 0,
      resumableSession: t.capabilities?.[p.handle]?.resumableSession ?? isResumableProvider(providerBase(p.provider)),
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
    // ①:completed 且非 success 时把结果态缀在 status 列(如 completed·degraded)
    const statusCol = v.status === "completed" && v.outcome && v.outcome !== "success"
      ? `${v.status}·${v.outcome}`
      : v.status;
    console.log(
      `${v.id.padEnd(28)} ${statusCol.padEnd(18)} ${v.mode.padEnd(11)} ${v.round.current}/${v.round.max} 轮  ${v.title}`,
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
