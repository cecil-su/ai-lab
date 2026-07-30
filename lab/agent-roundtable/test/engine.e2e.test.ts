import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendInbox, readPending } from "../src/store/inbox.js";
import { createTopic, loadTopic } from "../src/store/topic.js";
import { readTranscript } from "../src/store/transcript.js";
import { checkConverged, runTopic } from "../src/engine/runner.js";
import { resolveAdapter } from "../src/adapters/registry.js";
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
