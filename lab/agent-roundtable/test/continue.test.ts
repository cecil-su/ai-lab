import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeVerified, type ProviderAdapter, type SessionRef } from "../src/adapters/types.js";
import { resolveAdapter } from "../src/adapters/registry.js";
import { cmdContinue, cmdNew, cmdStop } from "../src/commands.js";
import { createTopic, loadTopic, saveTopic } from "../src/store/topic.js";
import { BudgetExhaustedError, runTopic } from "../src/engine/runner.js";
import { readTranscript, TRANSCRIPT_FILE } from "../src/store/transcript.js";
import { makeTmpDir, removeDir } from "./helpers.js";

function writeScript(dir: string, name: string, speeches: string[]): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ speeches }));
  return `mock:${file}`;
}

describe("cmdContinue 续谈(R3 方案 B)", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    removeDir(root);
    vi.restoreAllMocks();
  });

  async function makeCompletedTopic(id: string): Promise<string> {
    const p1 = writeScript(root, `${id}-1.json`, ["A1\n【立场】a1", "A2\n【立场】a2", "总结A", "追加A", "再追加A"]);
    const p2 = writeScript(root, `${id}-2.json`, ["B1\n【立场】b1", "B2\n【立场】b2", "总结B", "追加B", "再追加B"]);
    createTopic(root, {
      id,
      title: "续谈话题",
      mode: "roundtable",
      maxRounds: 2,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "a" },
        { handle: "mock-2", provider: p2, perspective: "b" },
      ],
    });
    const dir = path.join(root, id);
    await runTopic(dir, { installSignalHandlers: false });
    expect(loadTopic(dir).status).toBe("completed");
    return dir;
  }

  it("completed 无 flag → 拒绝并提示", async () => {
    const dir = await makeCompletedTopic("no-flag");
    const before = readTranscript(dir).length;
    const code = await cmdContinue(["no-flag"], {}, { root });
    expect(code).toBe(1);
    expect(readTranscript(dir).length).toBe(before); // 未改动
  });

  it("cancelled 可由 cmdContinue 显式重开,并清除伪造的上一代 outcome", async () => {
    const p1 = writeScript(root, "cancel-a.json", ["A1", "总结A"]);
    const p2 = writeScript(root, "cancel-b.json", ["B1", "总结B"]);
    createTopic(root, {
      id: "cancelled-reopen",
      title: "取消后续谈",
      mode: "roundtable",
      maxRounds: 1,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "a" },
        { handle: "mock-2", provider: p2, perspective: "b" },
      ],
    });
    expect(cmdStop(["cancelled-reopen"], {}, { root })).toBe(0);
    const dir = path.join(root, "cancelled-reopen");
    expect(loadTopic(dir).status).toBe("cancelled");
    saveTopic(dir, { ...loadTopic(dir), outcome: "failed" }); // 模拟旧/坏数据,重开必须清理

    const code = await cmdContinue(["cancelled-reopen"], { ask: "重新开始", more: "1" }, { root });
    expect(code).toBe(0);
    const done = loadTopic(dir);
    expect(done.status).toBe("completed");
    expect(done.outcome).toBe("success");
    expect(readTranscript(dir).some((e) => e.kind === "human" && e.body === "重新开始")).toBe(true);
  });

  it("--ask 重开:注入 human 事件、追加新一轮、seq 连续、summary 重生成", async () => {
    const dir = await makeCompletedTopic("with-ask");
    const before = readTranscript(dir);
    const summaryBefore = fs.readFileSync(path.join(dir, "summary.md"), "utf8");

    const code = await cmdContinue(["with-ask"], { ask: "针对成本再深入", more: "1" }, { root });
    expect(code).toBe(0);

    const after = readTranscript(dir);
    // human 事件已注入
    const human = after.find((e) => e.kind === "human" && e.body === "针对成本再深入");
    expect(human).toBeDefined();
    expect(human!.from).toBe("user");
    // 新增事件(比原来多)
    expect(after.length).toBeGreaterThan(before.length);
    // seq 连续无洞
    expect(after.map((e) => e.seq)).toEqual(after.map((_, i) => i + 1));
    // maxRounds 加了 1(2 → 3),状态回到 completed
    const topic = loadTopic(dir);
    expect(topic.maxRounds).toBe(3);
    expect(topic.status).toBe("completed");
    // summary 被重生成(内容变化)
    expect(fs.readFileSync(path.join(dir, "summary.md"), "utf8")).not.toBe(summaryBefore);
  });

  it("重开先清上一代 outcome;新一代暂停时不显示 active/paused·failed", async () => {
    const dir = await makeCompletedTopic("clear-outcome");
    saveTopic(dir, { ...loadTopic(dir), outcome: "failed" });
    let requestedPause = false;
    const pauseAfterFirstSpeech = (spec: string) => ({
      name: spec,
      capabilities: { codeAccess: "inherited" as const },
      async detect() { return { ok: true }; },
      async speak() {
        if (!requestedPause) {
          requestedPause = true;
          process.emit("SIGINT");
        }
        return {
          text: "本代先暂停",
          sessionRef: makeVerified("mock", "new-generation"),
          tokens: { input: 1, cached: 0, output: 1 },
        };
      },
    });

    const code = await cmdContinue(
      ["clear-outcome"],
      { ask: "稍后再试", more: "1" },
      { root, resolveAdapter: pauseAfterFirstSpeech },
    );
    expect(code).toBe(0);
    const paused = loadTopic(dir);
    expect(paused.status).toBe("paused");
    expect(paused.outcome).toBeUndefined();
  });

  it("崩溃后半行残留:continue 不二次崩溃,换行护栏隔离后正常续跑", async () => {
    const p1 = writeScript(root, "crash-a.json", ["观点A\n【立场】A", "续A\n【立场】A2", "总结A"]);
    const p2 = writeScript(root, "crash-b.json", ["观点B\n【立场】B", "续B\n【立场】B2", "总结B"]);
    createTopic(root, {
      id: "crash",
      title: "崩溃续跑",
      mode: "roundtable",
      maxRounds: 1,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "a" },
        { handle: "mock-2", provider: p2, perspective: "b" },
      ],
    });
    const dir = path.join(root, "crash");
    await runTopic(dir, { installSignalHandlers: false });

    // 模拟崩溃中途写出一行无换行的半 JSON(恢复现场红队场景)
    const file = path.join(dir, TRANSCRIPT_FILE);
    fs.appendFileSync(file, '{"seq":999,"kind":"mess');

    // continue 重开:readTranscript 容错 + append 换行护栏 → 不二次崩溃,正常续跑
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await cmdContinue(["crash"], { ask: "继续审查", more: "1" }, { root });
    expect(code).toBe(0);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("损坏已跳过"));
    errSpy.mockRestore();
    const after = readTranscript(dir);
    // 新轮发言在坏行之后正常落盘,seq 连续(半行不占 seq)
    expect(after.filter((e) => e.kind === "message" && e.round > 1).length).toBeGreaterThanOrEqual(2);
    expect(after.map((e) => e.seq)).toEqual(after.map((_, i) => i + 1));
  });

  it("崩溃现场对账:transcript commit 覆盖陈旧 topic.json 的会话/累计 token", async () => {
    const p1 = writeScript(root, "re-a.json", ["观点A\n【立场】A", "续A\n【立场】A2", "总结A"]);
    const p2 = writeScript(root, "re-b.json", ["观点B\n【立场】B", "续B\n【立场】B2", "总结B"]);
    createTopic(root, {
      id: "re",
      title: "崩溃恢复",
      mode: "roundtable",
      maxRounds: 1,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "a" },
        { handle: "mock-2", provider: p2, perspective: "b" },
      ],
    });
    const dir = path.join(root, "re");
    await runTopic(dir, { installSignalHandlers: false });

    // 记录 transcript 中最后一次 commit 的会话/累计 token(真相源)
    const done = loadTopic(dir);
    const commitRef = done.participants[0]!.sessionRef;
    const commitTokens = done.participants[0]!.tokens;
    expect(commitRef).not.toBeNull();

    // 模拟"appendEvent 成功、saveTopic 前崩溃":topic.json 仍是陈旧会话/零 token
    const stale = loadTopic(dir);
    stale.participants = stale.participants.map((p) =>
      p.handle === "mock-1"
        ? { ...p, sessionRef: makeVerified("mock", "STALE"), tokens: { input: 0, cached: 0, output: 0 } }
        : p,
    );
    saveTopic(dir, stale);

    // continue 重开:对账必须先把 mock-1 恢复为 transcript commit 值,再进入新轮发言
    const seen: (SessionRef | undefined)[] = [];
    const recording = (spec: string) => {
      const inner = resolveAdapter(spec);
      return {
        ...inner,
        async speak(o: Parameters<ProviderAdapter["speak"]>[0]) {
          seen.push(o.sessionRef);
          return inner.speak(o);
        },
      };
    };
    const code = await cmdContinue(["re"], { ask: "继续深入", more: "1" }, { root, resolveAdapter: recording });
    expect(code).toBe(0);

    // 第一轮发言拿到的是 transcript commit 的 ref,而不是陈旧 STALE
    expect(seen[0]?.value).toBe(commitRef!.value);
    expect(seen[0]?.value).not.toBe("STALE");
    // topic.json 已被对账修正:续谈新轮在此基础上推进(不得残留 STALE/零 token)
    const after = loadTopic(dir);
    expect(after.participants[0]!.sessionRef?.value).not.toBe("STALE");
    expect(after.participants[0]!.tokens.input).toBeGreaterThanOrEqual(commitTokens.input);
  });

  it("预算闭环:max-calls 用尽在轮次边界暂停并持久化,可提高上限续跑 (4模型裁决项 1)", async () => {
    const p1 = writeScript(root, "b-a.json", ["观点A\n【立场】A", "续A\n【立场】A2", "总结A"]);
    const p2 = writeScript(root, "b-b.json", ["观点B\n【立场】B", "续B\n【立场】B2", "总结B"]);
    // 2 轮:第 1 轮 2 次发言 + 第 2 轮 mock-1 发言(第 3 次)→ 预算 3 在 mock-2 发言前轮次边界暂停
    const code = await cmdNew(
      ["预算暂停"],
      { providers: `${p1},${p2}`, "max-rounds": "2", "max-calls": "3" },
      { root },
    );
    expect(code).toBe(0);
    const dir = path.join(root, "2026-07-31-预算暂停");
    const paused = loadTopic(dir);
    expect(paused.status).toBe("paused");
    expect(paused.calls).toBe(3);
    expect(paused.maxCalls).toBe(3);
    expect(readTranscript(dir).some((e) => e.kind === "system" && e.body?.includes("额度已用尽"))).toBe(true);

    // 预算已尽且未提高 → 拒绝
    const rejectCode = await cmdContinue(["2026-07-31-预算暂停"], { ask: "继续" }, { root });
    expect(rejectCode).toBe(1);

    // 提高上限后续跑:恢复第 2 轮剩余发言(mock-2)+ 收尾 = 2 次新调用,累计 5
    const resumeCode = await cmdContinue(
      ["2026-07-31-预算暂停"],
      { ask: "继续深入", "max-calls": "6" },
      { root },
    );
    expect(resumeCode).toBe(0);
    const done = loadTopic(dir);
    expect(done.status).toBe("completed");
    expect(done.calls).toBe(5); // 3 已用 + mock-2 第2轮发言 + 收尾
    // 第 2 轮确实补上了 mock-2 的发言
    expect(readTranscript(dir).filter((e) => e.kind === "message" && e.round === 2)).toHaveLength(2);
  });

  it("预算刚好够 → completed,calls 精确落盘", async () => {
    const p1 = writeScript(root, "b2-a.json", ["观点A\n【立场】A", "总结A"]);
    const p2 = writeScript(root, "b2-b.json", ["观点B\n【立场】B", "总结B"]);
    const code = await cmdNew(
      ["预算刚好"],
      { providers: `${p1},${p2}`, "max-rounds": "1", "max-calls": "3" },
      { root },
    );
    expect(code).toBe(0);
    const done = loadTopic(path.join(root, "2026-07-31-预算刚好"));
    expect(done.status).toBe("completed");
    expect(done.calls).toBe(3); // 2 发言 + 1 收尾
  });

  it("预算暂停与失败正交:不 bump failures、不清 ref、不记 error (方案A门槛)", async () => {
    const p1 = writeScript(root, "orth-a.json", ["观点A\n【立场】A", "续A\n【立场】A2", "总结A"]);
    const p2 = writeScript(root, "orth-b.json", ["观点B\n【立场】B", "续B\n【立场】B2", "总结B"]);
    // 第 1 轮 2 次预留 + 第 2 轮 mock-1 预留(第 3 次)后耗尽 → mock-2 发言前暂停
    await cmdNew(
      ["预算正交"],
      { providers: `${p1},${p2}`, "max-rounds": "2", "max-calls": "3" },
      { root },
    );
    const dir = path.join(root, "2026-07-31-预算正交");
    const t = loadTopic(dir);
    expect(t.status).toBe("paused");
    expect(t.calls).toBe(3);
    expect(t.calls).toBeLessThanOrEqual(t.maxCalls!); // 上界断言
    // 正交:mock-2 未被计失败、会话保留、无 error 事件
    const p2p = t.participants.find((p) => p.handle === "mock-2")!;
    expect(p2p.failures).toBe(0);
    expect(p2p.sessionRef).not.toBeNull();
    expect(readTranscript(dir).some((e) => e.kind === "error")).toBe(false);
  });

  it("预留记账:失败调用也占额度,崩溃后不回退 (方案A门槛)", async () => {
    const p1 = path.join(root, "reserve-a.json");
    fs.writeFileSync(p1, JSON.stringify({ speeches: [{ fail: "首次调用失败" }, "恢复\n【立场】A2"] }));
    const p2 = writeScript(root, "reserve-b.json", ["观点B\n【立场】B"]);
    // 第 1 轮 mock-1 失败(预留 1)+ mock-2(预留 2)= 2 = maxCalls → 耗尽暂停
    await cmdNew(
      ["预留记账"],
      { providers: `mock:${p1},${p2}`, "max-rounds": "1", "max-calls": "2" },
      { root },
    );
    const dir = path.join(root, "2026-07-31-预留记账");
    const t = loadTopic(dir);
    expect(t.status).toBe("paused");
    expect(t.calls).toBe(2); // 失败调用也预留,不回退
    expect(t.participants.find((p) => p.handle === "mock-1")!.failures).toBe(1); // 失败仍正常计数
    expect(readTranscript(dir).some((e) => e.kind === "error")).toBe(true);
  });

  it("finalize 额度不足:可恢复暂停,不写兜底 summary、不标 failed (方案A门槛)", async () => {
    const p1 = writeScript(root, "fin-a.json", ["观点A\n【立场】A", "总结A"]);
    createTopic(root, {
      id: "fin-budget",
      title: "收尾额度",
      mode: "roundtable",
      maxRounds: 1,
      participants: [{ handle: "mock-1", provider: p1, perspective: "a" }],
    });
    const dir = path.join(root, "fin-budget");
    const resolver = (spec: string): ProviderAdapter => {
      const inner = resolveAdapter(spec);
      return {
        ...inner,
        async speak(o) {
          if (o.prompt.includes("收尾任务")) throw new BudgetExhaustedError(1, 1);
          return inner.speak(o);
        },
      };
    };
    const done = await runTopic(dir, { resolveAdapter: resolver, installSignalHandlers: false });
    expect(done.status).toBe("paused");
    expect(done.finalization?.phase).toBe("pending"); // 可恢复:续跑按代际幂等
    expect(done.outcome).toBeUndefined(); // 不标 failed
    expect(fs.existsSync(path.join(dir, "summary.md"))).toBe(false); // 不写兜底
    expect(readTranscript(dir).some((e) => e.kind === "error")).toBe(false); // 不记 error
  });

  it("--as 指定插话人名", async () => {
    const dir = await makeCompletedTopic("with-as");
    await cmdContinue(["with-as"], { ask: "换个角度", as: "cecil" }, { root });
    const human = readTranscript(dir).find((e) => e.kind === "human");
    expect(human?.from).toBe("cecil");
  });

  it("F9:重开 debate 设 resumeFromSeq 水位线,续跑不把旧裁决喂回", async () => {
    const a = writeScript(root, "f9-a.json", ["A1\n【立场】a1", "A续\n【立场】a2", "A三\n【立场】a3"]);
    const b = writeScript(root, "f9-b.json", ["B1\n【立场】b1", "B续\n【立场】b2", "B三\n【立场】b3"]);
    createTopic(root, {
      id: "f9",
      title: "重开辩论",
      mode: "debate",
      maxRounds: 1,
      participants: [
        { handle: "mock-1", provider: a, perspective: "a" },
        { handle: "mock-2", provider: b, perspective: "b" },
      ],
    });
    const dir = path.join(root, "f9");
    await runTopic(dir, { installSignalHandlers: false });
    // 有裁决 verdict
    const verdictSeq = readTranscript(dir).find((e) => e.kind === "verdict")!.seq;

    await cmdContinue(["f9"], { ask: "再深入" }, { root });

    const topic = loadTopic(dir);
    // resumeFromSeq 已置为重开时的水位线(>= 裁决 seq)
    expect(topic.resumeFromSeq).toBeGreaterThanOrEqual(verdictSeq);
    // 续谈新增事件都在水位线之后;human 追问已注入
    const after = readTranscript(dir);
    const human = after.find((e) => e.kind === "human" && e.body === "再深入");
    expect(human).toBeDefined();
    expect(human!.seq).toBeGreaterThan(topic.resumeFromSeq!);
  });

  it("F1:--timeout 非法值早退 1(不开题)", async () => {
    const p1 = writeScript(root, "to-a.json", ["x"]);
    const p2 = writeScript(root, "to-b.json", ["y"]);
    const code = await cmdNew(
      ["超时校验"],
      { providers: `${p1},${p2}`, timeout: "abc" },
      { root },
    );
    expect(code).toBe(1);
  });
});
