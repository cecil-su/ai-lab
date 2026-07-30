import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendInbox, readPending } from "../src/store/inbox.js";
import { createTopic, loadTopic } from "../src/store/topic.js";
import { readTranscript } from "../src/store/transcript.js";
import { checkConverged, runTopic } from "../src/engine/runner.js";
import { resolveAdapter } from "../src/adapters/registry.js";
import { REASONIX_LAST_SESSION } from "../src/adapters/reasonix.js";
import type { ProviderAdapter } from "../src/adapters/types.js";
import { makeTmpDir, removeDir } from "./helpers.js";

interface SpeakCall {
  spec: string;
  sessionRef: string | undefined;
  prompt: string;
  cwd: string;
  codeAccess: boolean | undefined;
}

// 包裹真实 resolver,记录每次 speak 的 sessionRef/prompt/spec/cwd/codeAccess
function recordingResolver(calls: SpeakCall[]): (spec: string) => ProviderAdapter {
  return (spec) => {
    const inner = resolveAdapter(spec);
    return {
      ...inner,
      async speak(o) {
        calls.push({ spec, sessionRef: o.sessionRef, prompt: o.prompt, cwd: o.cwd, codeAccess: o.codeAccess });
        return inner.speak(o);
      },
    };
  };
}

function writeScript(dir: string, name: string, speeches: string[]): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ speeches }));
  return `mock:${file}`;
}

function seqs(dir: string): number[] {
  return readTranscript(dir).map((e) => e.seq);
}

describe("engine e2e (mock providers)", () => {
  let root: string;
  beforeEach(() => (root = makeTmpDir()));
  afterEach(() => removeDir(root));

  it("pause on SIGINT then continue to completion", async () => {
    const p1 = writeScript(root, "p1.json", [
      "观点A1\n【立场】立场A1",
      "观点A2\n【立场】立场A2",
      "观点A3\n【立场】立场A3",
      "综合总结A",
    ]);
    const p2 = writeScript(root, "p2.json", [
      "观点B1\n【立场】立场B1",
      "观点B2\n【立场】立场B2",
      "观点B3\n【立场】立场B3",
      "综合总结B",
    ]);
    createTopic(root, {
      id: "topic-1",
      title: "缓存选型",
      mode: "roundtable",
      maxRounds: 3,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "架构" },
        { handle: "mock-2", provider: p2, perspective: "成本" },
      ],
    });
    const dir = path.join(root, "topic-1");

    // 跑 2 轮后模拟 SIGINT(round_end round=2 时请求停止)
    const paused = await runTopic(dir, {
      installSignalHandlers: false,
      onEvent: (e, ctx) => {
        if (e.kind === "round_end" && e.round === 2) ctx.requestStop();
      },
    });

    expect(paused.status).toBe("paused");
    expect(paused.currentRound).toBe(2);
    const afterPause = readTranscript(dir);
    expect(afterPause.filter((e) => e.round === 3)).toHaveLength(0);
    expect(afterPause.filter((e) => e.kind === "round_end").map((e) => e.round)).toEqual([1, 2]);
    // 立场行被提取到事件上
    const r1p1 = afterPause.find((e) => e.round === 1 && e.from === "mock-1");
    expect(r1p1?.stance).toBe("立场A1");
    // seq-1 = 开题 system 事件,其后 2 轮各 2 message + round_end
    expect(afterPause[0]).toMatchObject({ seq: 1, kind: "system", round: 0 });
    expect(seqs(dir)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(fs.existsSync(path.join(dir, "runner.lock"))).toBe(false);

    // 恢复并跑完
    const done = await runTopic(dir, { installSignalHandlers: false });
    expect(done.status).toBe("completed");
    expect(done.currentRound).toBe(3);
    const final = readTranscript(dir);
    expect(final.filter((e) => e.kind === "round_end").map((e) => e.round)).toEqual([1, 2, 3]);
    // seq 连续无洞
    expect(final.map((e) => e.seq)).toEqual(final.map((_, i) => i + 1));
    expect(fs.existsSync(path.join(dir, "summary.md"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "summary.md"), "utf8")).toContain("综合总结B");
  });

  it("loop guard converges when stances repeat", async () => {
    const p1 = writeScript(root, "c1.json", ["同A\n【立场】恒定A"]);
    const p2 = writeScript(root, "c2.json", ["同B\n【立场】恒定B"]);
    createTopic(root, {
      id: "topic-2",
      title: "收敛话题",
      mode: "roundtable",
      maxRounds: 5,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "a" },
        { handle: "mock-2", provider: p2, perspective: "b" },
      ],
    });
    const dir = path.join(root, "topic-2");
    const done = await runTopic(dir, { installSignalHandlers: false });

    expect(done.status).toBe("completed");
    expect(done.currentRound).toBe(2); // 第2轮与第1轮立场相同 → 提前收尾
    expect(fs.readFileSync(path.join(dir, "summary.md"), "utf8")).toContain("已收敛");
  });

  it("debate: fights maxRounds then a fresh-session judge writes verdict + summary", async () => {
    const a = writeScript(root, "d-a.json", [
      "A开场:必须上 Redis\n【立场】上 Redis",
      "A二轮:Redis 运维成本可控\n【立场】仍上 Redis",
    ]);
    const b = writeScript(root, "d-b.json", [
      "B开场:内存足够,别引依赖\n【立场】用内存",
      "B二轮:Redis 是过度设计\n【立场】仍用内存",
    ]);
    createTopic(root, {
      id: "debate-1",
      title: "缓存选型",
      mode: "debate",
      maxRounds: 2,
      participants: [
        { handle: "mock-1", provider: a, perspective: "架构" },
        { handle: "mock-2", provider: b, perspective: "成本" },
      ],
    });
    const dir = path.join(root, "debate-1");

    const calls: SpeakCall[] = [];
    const done = await runTopic(dir, { installSignalHandlers: false, resolveAdapter: recordingResolver(calls) });

    expect(done.status).toBe("completed");
    expect(done.currentRound).toBe(2);

    const events = readTranscript(dir);
    // seq 连续无洞
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    // round 边界:开题 system(0) + 交锋 round_end 仅 [1,2],裁决在 round 3 且无 round_end
    expect(events[0]).toMatchObject({ seq: 1, kind: "system", round: 0 });
    expect(events.filter((e) => e.kind === "round_end").map((e) => e.round)).toEqual([1, 2]);
    expect(events.filter((e) => e.round === 3 && e.kind === "round_end")).toHaveLength(0);

    // verdict 事件:裁决人 handle = provider 基名 + "-judge",出现在裁决轮
    const verdict = events.find((e) => e.kind === "verdict");
    expect(verdict).toMatchObject({ kind: "verdict", round: 3, from: "mock-judge" });

    // 裁决者该轮是全新会话:带「裁决任务」的那次 speak 的 sessionRef 为空,且走第一位参与者的 provider
    const judgeCall = calls.find((c) => c.prompt.includes("裁决任务"));
    expect(judgeCall).toBeDefined();
    expect(judgeCall!.sessionRef).toBeUndefined();
    expect(judgeCall!.spec).toBe(a);

    // summary.md 生成且含裁决正文
    const summary = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
    expect(summary).toContain("# 裁决:缓存选型");
    expect(summary).toContain(verdict!.body!);
  });

  it("debate: early convergence still triggers the verdict round", async () => {
    // 每方每轮立场恒定 → 第2轮与第1轮相同,提前收敛(未跑满 maxRounds=5)
    const a = writeScript(root, "dc-a.json", ["A坚持\n【立场】恒定A"]);
    const b = writeScript(root, "dc-b.json", ["B坚持\n【立场】恒定B"]);
    createTopic(root, {
      id: "debate-2",
      title: "收敛辩论",
      mode: "debate",
      maxRounds: 5,
      participants: [
        { handle: "mock-1", provider: a, perspective: "a" },
        { handle: "mock-2", provider: b, perspective: "b" },
      ],
    });
    const dir = path.join(root, "debate-2");

    const done = await runTopic(dir, { installSignalHandlers: false });

    expect(done.status).toBe("completed");
    expect(done.currentRound).toBe(2); // 提前收敛,未跑满 5 轮
    const events = readTranscript(dir);
    const verdict = events.find((e) => e.kind === "verdict");
    expect(verdict).toMatchObject({ round: 3, from: "mock-judge" });
    expect(fs.readFileSync(path.join(dir, "summary.md"), "utf8")).toContain("已收敛");
  });

  it("writes seq-1 system event on open; continue does not duplicate it", async () => {
    const p1 = writeScript(root, "s1.json", ["观点1\n【立场】s1", "观点2\n【立场】s2", "总结"]);
    const p2 = writeScript(root, "s2.json", ["观点1b\n【立场】s1b", "观点2b\n【立场】s2b", "总结b"]);
    createTopic(root, {
      id: "sys-1",
      title: "开题事件",
      mode: "roundtable",
      maxRounds: 2,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "a" },
        { handle: "mock-2", provider: p2, perspective: "b" },
      ],
    });
    const dir = path.join(root, "sys-1");

    // 跑 1 轮后暂停
    const paused = await runTopic(dir, {
      installSignalHandlers: false,
      onEvent: (e, ctx) => {
        if (e.kind === "round_end" && e.round === 1) ctx.requestStop();
      },
    });
    expect(paused.status).toBe("paused");
    const t1 = readTranscript(dir);
    expect(t1[0]).toMatchObject({ seq: 1, kind: "system", round: 0 });
    expect(t1.filter((e) => e.kind === "system" && e.round === 0)).toHaveLength(1);

    // continue 恢复:不得再写第二条开题 system 事件
    await runTopic(dir, { installSignalHandlers: false });
    const t2 = readTranscript(dir);
    expect(t2.filter((e) => e.kind === "system" && e.round === 0)).toHaveLength(1);
  });

  it("注入的参考材料(charter)出现在发给参与者的 prompt 中", async () => {
    const p1 = writeScript(root, "ctx1.json", ["看过材料了\n【立场】ok"]);
    createTopic(root, {
      id: "ctx-1",
      title: "带材料的话题",
      mode: "roundtable",
      maxRounds: 1,
      participants: [{ handle: "mock-1", provider: p1, perspective: "a" }],
    });
    const dir = path.join(root, "ctx-1");
    // 模拟 cmdNew 写入含参考材料的 charter
    fs.writeFileSync(
      path.join(dir, "charter.md"),
      "# 话题:带材料的话题\n\n## 参考材料\n### foo.ts\n```ts\nexport const MAGIC = 42;\n```\n",
    );

    const calls: SpeakCall[] = [];
    await runTopic(dir, { installSignalHandlers: false, resolveAdapter: recordingResolver(calls) });

    expect(calls[0]!.prompt).toContain("## 参考材料");
    expect(calls[0]!.prompt).toContain("export const MAGIC = 42;");
  });

  it("增量 prompt(R4b):首轮全量含 charter,续接轮只发增量且更短", async () => {
    const p1 = writeScript(root, "inc1.json", ["A轮1\n【立场】a1", "A轮2\n【立场】a2", "A轮3\n【立场】a3"]);
    const p2 = writeScript(root, "inc2.json", ["B轮1\n【立场】b1", "B轮2\n【立场】b2", "B轮3\n【立场】b3"]);
    createTopic(root, {
      id: "inc-1",
      title: "增量话题",
      mode: "roundtable",
      maxRounds: 3,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "a" },
        { handle: "mock-2", provider: p2, perspective: "b" },
      ],
    });
    const dir = path.join(root, "inc-1");
    // 写一个体量可观的 charter,凸显全量 vs 增量差距
    fs.writeFileSync(
      path.join(dir, "charter.md"),
      "# 话题:增量话题\n\n## 参考材料\nCHARTER_MARK\n" + "背景说明。".repeat(200) + "\n",
    );

    const calls: SpeakCall[] = [];
    await runTopic(dir, { installSignalHandlers: false, resolveAdapter: recordingResolver(calls) });

    // 顺序:calls[0]=mock-1 R1, [1]=mock-2 R1, [2]=mock-1 R2, [3]=mock-2 R2, ...
    const p1r1 = calls[0]!.prompt;
    const p1r2 = calls[2]!.prompt;
    // 首轮全量:含 charter 标记
    expect(p1r1).toContain("CHARTER_MARK");
    expect(p1r1).toContain("## 发言协议");
    // 续接轮增量:不含 charter,含最新进展 + 对方上轮发言
    expect(p1r2).not.toContain("CHARTER_MARK");
    expect(p1r2).toContain("## 最新进展(你上次发言后)");
    expect(p1r2).toContain("B轮1");
    // 增量显著更短
    expect(p1r2.length).toBeLessThan(p1r1.length / 2);
  });

  it("自读(R2):设 repo 时 speak 用 repo cwd + codeAccess=true", async () => {
    const p1 = writeScript(root, "repo1.json", ["读过代码\n【立场】ok"]);
    const repoDir = path.join(root, "fake-repo");
    fs.mkdirSync(repoDir);
    createTopic(root, {
      id: "repo-1",
      title: "自读话题",
      mode: "roundtable",
      maxRounds: 1,
      participants: [{ handle: "mock-1", provider: p1, perspective: "a" }],
      repo: repoDir,
    });
    const dir = path.join(root, "repo-1");
    const calls: SpeakCall[] = [];
    await runTopic(dir, { installSignalHandlers: false, resolveAdapter: recordingResolver(calls) });
    expect(calls[0]!.cwd).toBe(repoDir);
    expect(calls[0]!.codeAccess).toBe(true);
  });

  it("未设 repo 时 speak 用话题目录 cwd + codeAccess=false(回归)", async () => {
    const p1 = writeScript(root, "norepo1.json", ["讨论\n【立场】ok"]);
    createTopic(root, {
      id: "norepo-1",
      title: "无 repo 话题",
      mode: "roundtable",
      maxRounds: 1,
      participants: [{ handle: "mock-1", provider: p1, perspective: "a" }],
    });
    const dir = path.join(root, "norepo-1");
    const calls: SpeakCall[] = [];
    await runTopic(dir, { installSignalHandlers: false, resolveAdapter: recordingResolver(calls) });
    expect(calls[0]!.cwd).toBe(dir);
    expect(calls[0]!.codeAccess).toBe(false);
  });

  it("F1:单 provider 抛错记 error 事件、该参与者跳过、其余照跑、收尾 completed", async () => {
    const good = writeScript(root, "f1-good.json", ["正常发言\n【立场】ok", "总结"]);
    const bad = writeScript(root, "f1-bad.json", ["never used"]);
    createTopic(root, {
      id: "f1-1",
      title: "单点失败",
      mode: "roundtable",
      maxRounds: 1,
      participants: [
        { handle: "mock-bad", provider: bad, perspective: "a" },
        { handle: "mock-good", provider: good, perspective: "b" },
      ],
    });
    const dir = path.join(root, "f1-1");
    // mock-bad 的 speak 抛错(模拟超时/崩溃)
    const resolver = (spec: string): ProviderAdapter => {
      const inner = resolveAdapter(spec);
      if (spec === bad) return { ...inner, async speak() { throw new Error("boom 超时(2ms)"); } };
      return inner;
    };
    const done = await runTopic(dir, { installSignalHandlers: false, resolveAdapter: resolver });

    expect(done.status).toBe("completed");
    const events = readTranscript(dir);
    const err = events.find((e) => e.kind === "error" && e.from === "mock-bad");
    expect(err?.body).toContain("boom");
    // mock-good 正常发言
    expect(events.find((e) => e.kind === "message" && e.from === "mock-good")).toBeDefined();
    // 失败者 sessionRef/tokens 未被更新
    expect(done.participants.find((p) => p.handle === "mock-bad")!.sessionRef).toBeNull();
    // seq 连续无洞
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  });

  it("F1:全体失败轮提前收敛,仍落 completed", async () => {
    const bad = writeScript(root, "f1-allbad.json", ["x"]);
    createTopic(root, {
      id: "f1-2",
      title: "全体失败",
      mode: "roundtable",
      maxRounds: 3,
      participants: [{ handle: "mock-1", provider: bad, perspective: "a" }],
    });
    const dir = path.join(root, "f1-2");
    const resolver = (spec: string): ProviderAdapter => ({
      ...resolveAdapter(spec),
      async speak() { throw new Error("全挂"); },
    });
    const done = await runTopic(dir, { installSignalHandlers: false, resolveAdapter: resolver });
    expect(done.status).toBe("completed");
    expect(done.currentRound).toBe(1); // 全员失败 → 首轮即收敛,不空转到 maxRounds
  });

  it("F1:finalize 失败也落 completed 并记 error 事件", async () => {
    const bad = writeScript(root, "f1-fin.json", ["会崩"]);
    createTopic(root, {
      id: "f1-3",
      title: "收尾失败",
      mode: "debate",
      maxRounds: 1,
      participants: [
        { handle: "mock-1", provider: bad, perspective: "a" },
        { handle: "mock-2", provider: bad, perspective: "b" },
      ],
    });
    const dir = path.join(root, "f1-3");
    // 全程抛错:交锋轮各记 error,裁决(finalize)也抛 → 被兜底
    const resolver = (spec: string): ProviderAdapter => ({
      ...resolveAdapter(spec),
      async speak() { throw new Error("provider 挂了"); },
    });
    const done = await runTopic(dir, { installSignalHandlers: false, resolveAdapter: resolver });
    expect(done.status).toBe("completed");
    expect(readTranscript(dir).some((e) => e.kind === "error")).toBe(true);
    // F10:finalize 失败仍写兜底 summary.md,避免伪完成
    const summary = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
    expect(summary).toContain("总结生成失败");
  });

  it("F8:成功过一轮后再失败 → sessionRef 被作废(下轮全量新会话)", async () => {
    let call = 0;
    const flaky: ProviderAdapter = {
      name: "flaky",
      async detect() { return { ok: true }; },
      async speak() {
        call++;
        if (call === 1) return { text: "第一轮\n【立场】a", sessionRef: "real-sid", tokens: { input: 1, cached: 0, output: 1 } };
        throw new Error("第二轮挂了");
      },
    };
    createTopic(root, {
      id: "f8-1",
      title: "失败作废会话",
      mode: "roundtable",
      maxRounds: 2,
      participants: [{ handle: "mock-1", provider: "mock:x", perspective: "a" }],
    });
    const dir = path.join(root, "f8-1");
    const done = await runTopic(dir, { installSignalHandlers: false, resolveAdapter: () => flaky });
    // 第1轮拿到 real-sid,第2轮失败 → 作废回 null
    expect(done.participants[0]!.sessionRef).toBeNull();
  });

  it("F4①:降级 sessionRef(@last)→ 全量 prompt + 告警,不走增量", async () => {
    const prompts: string[] = [];
    const refsSeen: (string | undefined)[] = [];
    let turn = 0;
    // 模拟 reasonix 降级:每次返回 @last 哨兵
    const degraded: ProviderAdapter = {
      name: "fake-rx",
      async detect() { return { ok: true }; },
      async speak(o) {
        prompts.push(o.prompt);
        refsSeen.push(o.sessionRef);
        turn++;
        return { text: `发言${turn}\n【立场】s${turn}`, sessionRef: REASONIX_LAST_SESSION, tokens: { input: 1, cached: 0, output: 1 } };
      },
    };
    createTopic(root, {
      id: "f4-1",
      title: "降级话题",
      mode: "roundtable",
      maxRounds: 2,
      participants: [{ handle: "rx-1", provider: "mock:x", perspective: "a" }],
    });
    const dir = path.join(root, "f4-1");
    fs.writeFileSync(path.join(dir, "charter.md"), "# 话题:降级话题\n\n## 参考材料\nF4_CHARTER_MARK\n");

    await runTopic(dir, { installSignalHandlers: false, resolveAdapter: () => degraded });

    // 第2轮:sessionRef=@last(降级)→ 仍全量(含 charter),而非增量
    expect(prompts[1]).toContain("F4_CHARTER_MARK");
    // F8:降级 ref 不传给 adapter(传 undefined 走新会话,不再 -c 续错线程)
    expect(refsSeen[1]).toBeUndefined();
    // 告警事件已写入
    const warn = readTranscript(dir).find(
      (e) => e.kind === "system" && (e.body ?? "").includes("会话降级"),
    );
    expect(warn).toBeDefined();
  });

  it("A2:inbox 坏行落 error 事件、正常插话仍消费、讨论继续", async () => {
    const p1 = writeScript(root, "a2.json", ["回应\n【立场】ok"]);
    createTopic(root, {
      id: "a2-1",
      title: "坏行容错",
      mode: "roundtable",
      maxRounds: 1,
      participants: [{ handle: "mock-1", provider: p1, perspective: "a" }],
    });
    const dir = path.join(root, "a2-1");
    // 一条坏行 + 一条正常插话
    fs.appendFileSync(path.join(dir, "inbox.jsonl"), "{坏行}\n");
    appendInbox(dir, { kind: "say", from: "cecil", body: "正常追问" });

    await runTopic(dir, { installSignalHandlers: false });

    const events = readTranscript(dir);
    // 坏行 → error 事件
    expect(events.some((e) => e.kind === "error" && (e.body ?? "").includes("损坏"))).toBe(true);
    // 正常插话 → human 事件被消费
    expect(events.some((e) => e.kind === "human" && e.body === "正常追问")).toBe(true);
    expect(loadTopic(dir).status).toBe("completed");
  });

  it("A1:连续失败达阈值 → 自动 paused + 损失评估事件 + failures 计数", async () => {
    // 一家总失败、一家每轮变立场成功(避免全体失败收敛/立场收敛),让失败者连败 3 轮
    const good = writeScript(root, "a1-good.json", [
      "G1\n【立场】g1", "G2\n【立场】g2", "G3\n【立场】g3", "G4\n【立场】g4",
    ]);
    const bad: ProviderAdapter = {
      name: "always-fail",
      async detect() { return { ok: true }; },
      async speak() { throw new Error("总是超时"); },
    };
    createTopic(root, {
      id: "a1-1",
      title: "连续失败熔断",
      mode: "roundtable",
      maxRounds: 10,
      participants: [
        { handle: "mock-bad", provider: "mock:placeholder", perspective: "a" },
        { handle: "mock-good", provider: good, perspective: "b" },
      ],
    });
    const dir = path.join(root, "a1-1");
    const resolver = (spec: string): ProviderAdapter => (spec === good ? resolveAdapter(good) : bad);
    const done = await runTopic(dir, { installSignalHandlers: false, resolveAdapter: resolver });
    // 连续 3 轮失败 → 自动暂停(非 TTY 不提问),远未跑满 maxRounds=10
    expect(done.status).toBe("paused");
    expect(done.participants.find((p) => p.handle === "mock-bad")!.failures).toBeGreaterThanOrEqual(3);
    // 损失评估 system 事件
    const est = readTranscript(dir).find(
      (e) => e.kind === "system" && (e.body ?? "").includes("连续") && (e.body ?? "").includes("已消耗 ≥"),
    );
    expect(est).toBeDefined();
  });

  it("checkConverged: all-skip round converges immediately", () => {
    const events = readTranscriptFrom([
      { seq: 1, ts: "", kind: "skip", round: 1, from: "a" },
      { seq: 2, ts: "", kind: "skip", round: 1, from: "b" },
    ]);
    expect(checkConverged(events, 1)).toBe(true);
  });

  it("consumes inbox interjections into human events", async () => {
    const p1 = writeScript(root, "h1.json", ["回应插话\n【立场】收到"]);
    createTopic(root, {
      id: "topic-3",
      title: "插话话题",
      mode: "roundtable",
      maxRounds: 1,
      participants: [{ handle: "mock-1", provider: p1, perspective: "a" }],
    });
    const dir = path.join(root, "topic-3");
    appendInbox(dir, { kind: "say", from: "cecil", body: "补充约束X" });

    await runTopic(dir, { installSignalHandlers: false });

    const events = readTranscript(dir);
    const human = events.find((e) => e.kind === "human");
    expect(human).toMatchObject({ from: "cecil", body: "补充约束X", round: 1 });
    expect(readPending(dir)).toHaveLength(0);
    // 状态机与磁盘一致
    expect(loadTopic(dir).status).toBe("completed");
  });
});

// checkConverged 接受任意 TranscriptEvent[];这里直接构造(绕过 seq 校验的磁盘读)
function readTranscriptFrom(events: Parameters<typeof checkConverged>[0]): typeof events {
  return events;
}
