import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTopic, loadTopic, saveTopic } from "../src/store/topic.js";
import { runTopic } from "../src/engine/runner.js";
import { selectMode } from "../src/engine/modes.js";
import { appendEvent } from "../src/store/transcript.js";
import { resolveAdapter } from "../src/adapters/registry.js";
import { makeDegraded, makeVerified, type ProviderAdapter, type SessionRef } from "../src/adapters/types.js";
import { makeTmpDir, removeDir } from "./helpers.js";

function writeScript(dir: string, name: string, speeches: string[]): string {
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ speeches }));
  return `mock:${path.join(dir, name)}`;
}

describe("finalize 信任闸门 + summary 覆盖 (#5)", () => {
  let root: string;
  beforeEach(() => (root = makeTmpDir()));
  afterEach(() => removeDir(root));

  it("roundtable.finalize 对降级 ref(@last)不走增量,传 undefined", async () => {
    const p1 = writeScript(root, "p1.json", ["综合总结"]);
    createTopic(root, {
      id: "t",
      title: "x",
      mode: "roundtable",
      maxRounds: 1,
      participants: [{ handle: "mock-1", provider: p1, perspective: "架构" }],
    });
    const dir = path.join(root, "t");
    const topic = loadTopic(dir);
    // 末位总结者持有降级哨兵(degraded)
    topic.participants[topic.participants.length - 1]!.sessionRef = makeDegraded("reasonix");

    let captured: SessionRef | undefined;
    let called = false;
    const adapter: ProviderAdapter = {
      ...resolveAdapter(p1),
      async speak(o) {
        called = true;
        captured = o.sessionRef;
        return { text: "总结", sessionRef: makeVerified("mock", "1"), tokens: { input: 1, cached: 0, output: 1 } };
      },
    };

    await selectMode("roundtable").finalize({
      dir,
      charter: "# c",
      topic,
      adapters: new Map([["mock-1", adapter]]),
      converged: false,
      timeoutMs: 1000,
      emit: () => {},
    });

    expect(called).toBe(true);
    expect(captured).toBeUndefined(); // degraded 被闸门拦下 → 全量新会话
  });

  it("可信 ref 正常透传给 finalize", async () => {
    const p1 = writeScript(root, "p1.json", ["综合总结"]);
    createTopic(root, {
      id: "t",
      title: "x",
      mode: "roundtable",
      maxRounds: 1,
      participants: [{ handle: "mock-1", provider: p1, perspective: "架构" }],
    });
    const dir = path.join(root, "t");
    const topic = loadTopic(dir);
    topic.participants[0]!.sessionRef = makeVerified("mock", "42");

    let captured: SessionRef | undefined;
    const adapter: ProviderAdapter = {
      ...resolveAdapter(p1),
      async speak(o) {
        captured = o.sessionRef;
        return { text: "总结", sessionRef: makeVerified("mock", "43"), tokens: { input: 1, cached: 0, output: 1 } };
      },
    };

    await selectMode("roundtable").finalize({
      dir,
      charter: "# c",
      topic,
      adapters: new Map([["mock-1", adapter]]),
      converged: false,
      timeoutMs: 1000,
      emit: () => {},
    });

    expect(captured?.value).toBe("42");
  });

  it("finalize 失败:覆盖旧 summary + 清末位总结者 ref", async () => {
    const p1 = writeScript(root, "p1.json", ["观点A\n【立场】A", "综合A"]);
    const p2 = writeScript(root, "p2.json", ["观点B\n【立场】B", "综合B"]);
    createTopic(root, {
      id: "t",
      title: "x",
      mode: "roundtable",
      maxRounds: 1,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "架构" },
        { handle: "mock-2", provider: p2, perspective: "成本" },
      ],
    });
    const dir = path.join(root, "t");
    // 预置上一代旧 summary(续谈场景);本代收尾失败必须覆盖它
    fs.writeFileSync(path.join(dir, "summary.md"), "# 旧结论\n\n上一代的正式结论 OLDCONTENT\n");

    // 只在收尾时抛错(收尾 prompt 含「收尾任务」),普通轮正常
    const failFinalize = (spec: string): ProviderAdapter => {
      const inner = resolveAdapter(spec);
      return {
        ...inner,
        async speak(o) {
          if (o.prompt.includes("收尾任务")) throw new Error("裁决人挂了");
          return inner.speak(o);
        },
      };
    };

    const topic = await runTopic(dir, { resolveAdapter: failFinalize, installSignalHandlers: false });

    expect(topic.status).toBe("completed");
    expect(topic.outcome).toBe("failed"); // ①:finalize 自身失败 → failed
    const summary = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
    expect(summary).not.toContain("OLDCONTENT"); // 旧结论被覆盖
    expect(summary).toContain("无正式结论");
    expect(summary).toContain("裁决人挂了");
    // 末位总结者(mock-2)的 ref 被作废
    const last = loadTopic(dir).participants.find((p) => p.handle === "mock-2")!;
    expect(last.sessionRef).toBeNull();
  });

  it("debate finalize 失败:不清末位参与者 ref(裁决人是临时身份) (4模型反馈项 2)", async () => {
    const p1 = writeScript(root, "deb-a.json", ["立论A\n【立场】A", "补A\n【立场】A"]);
    const p2 = writeScript(root, "deb-b.json", ["立论B\n【立场】B", "补B\n【立场】B"]);
    createTopic(root, {
      id: "deb-fail",
      title: "裁决人挂了",
      mode: "debate",
      maxRounds: 1,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "正方" },
        { handle: "mock-2", provider: p2, perspective: "反方" },
      ],
    });
    const dir = path.join(root, "deb-fail");
    // 先正常跑一轮(参与者获得真实 ref),再让裁决轮(「裁决任务」)抛错
    const failJudge = (spec: string): ProviderAdapter => {
      const inner = resolveAdapter(spec);
      return {
        ...inner,
        async speak(o) {
          if (o.prompt.includes("裁决任务")) throw new Error("裁决 provider 挂了");
          return inner.speak(o);
        },
      };
    };
    const topic = await runTopic(dir, { resolveAdapter: failJudge, installSignalHandlers: false });
    expect(topic.status).toBe("completed");
    expect(topic.outcome).toBe("failed");
    const after = loadTopic(dir);
    // debate 末位参与者(mock-2)是正常辩论者,其会话 ref 必须保留,不能被当作"总结者"误清
    const p2ref = after.participants.find((p) => p.handle === "mock-2")!.sessionRef;
    expect(p2ref).not.toBeNull();
  });
});

describe("debate finalize 崩溃幂等 (#6)", () => {
  let root: string;
  beforeEach(() => (root = makeTmpDir()));
  afterEach(() => removeDir(root));

  it("已有本代 verdict → 据其重建 summary,不再调裁决人", async () => {
    const p1 = writeScript(root, "p1.json", ["立论A"]);
    createTopic(root, {
      id: "t",
      title: "要不要上 K8s",
      mode: "debate",
      maxRounds: 2,
      participants: [{ handle: "mock-1", provider: p1, perspective: "正方" }],
    });
    const dir = path.join(root, "t");
    // 模拟"verdict 已 append 但 status 未 completed"的崩溃中间态
    const topic = loadTopic(dir);
    topic.participants[0]!.sessionRef = null;
    (topic as { currentRound: number }).currentRound = 2; // verdictRound = 3
    appendEvent(dir, { kind: "verdict", round: 3, from: "mock-judge", body: "结论:先不上 K8s" });

    let speakCalls = 0;
    const adapter: ProviderAdapter = {
      ...resolveAdapter(p1),
      async speak() {
        speakCalls += 1;
        return { text: "不该被调用", sessionRef: makeVerified("mock", "x"), tokens: { input: 1, cached: 0, output: 1 } };
      },
    };

    await selectMode("debate").finalize({
      dir,
      charter: "# c",
      topic,
      adapters: new Map([["mock-1", adapter]]),
      converged: false,
      timeoutMs: 1000,
      emit: () => {},
    });

    expect(speakCalls).toBe(0); // 不再二次裁决
    const summary = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
    expect(summary).toContain("先不上 K8s"); // 据已有 verdict 重建
  });

  it("无已有 verdict → 正常调裁决人", async () => {
    const p1 = writeScript(root, "p1.json", ["立论A"]);
    createTopic(root, {
      id: "t",
      title: "x",
      mode: "debate",
      maxRounds: 2,
      participants: [{ handle: "mock-1", provider: p1, perspective: "正方" }],
    });
    const dir = path.join(root, "t");
    const topic = loadTopic(dir);
    (topic as { currentRound: number }).currentRound = 2;

    let speakCalls = 0;
    const adapter: ProviderAdapter = {
      ...resolveAdapter(p1),
      async speak() {
        speakCalls += 1;
        return { text: "裁决:结论X", sessionRef: makeVerified("mock", "x"), tokens: { input: 1, cached: 0, output: 1 } };
      },
    };

    await selectMode("debate").finalize({
      dir,
      charter: "# c",
      topic,
      adapters: new Map([["mock-1", adapter]]),
      converged: false,
      timeoutMs: 1000,
      emit: () => {},
    });

    expect(speakCalls).toBe(1); // 无中间态 → 照常裁决
  });
});

describe("finalization generation 崩溃恢复 (③)", () => {
  let root: string;
  beforeEach(() => (root = makeTmpDir()));
  afterEach(() => removeDir(root));

  // 构造"收尾中途崩溃"的话题:status 仍 active、rounds 用尽、带 finalization 标记
  function seedInterrupted(
    phase: "pending" | "summary-written",
    opts: { verdict?: boolean; summary?: string } = {},
  ): { dir: string; countingResolver: (spec: string) => ProviderAdapter; calls: () => number } {
    const p1 = writeScript(root, "p1.json", ["立论A"]);
    createTopic(root, {
      id: "t",
      title: "要不要上 K8s",
      mode: "debate",
      maxRounds: 2,
      participants: [{ handle: "mock-1", provider: p1, perspective: "正方" }],
    });
    const dir = path.join(root, "t");
    let topic = loadTopic(dir);
    topic = { ...topic, currentRound: 2, finalization: { generation: 1, phase } };
    saveTopic(dir, topic);
    if (opts.verdict) appendEvent(dir, { kind: "verdict", round: 3, from: "mock-judge", body: "结论:先不上 K8s" });
    if (opts.summary) fs.writeFileSync(path.join(dir, "summary.md"), opts.summary);

    let n = 0;
    const countingResolver = (spec: string): ProviderAdapter => ({
      ...resolveAdapter(spec),
      async speak() {
        n += 1;
        return { text: "裁决:新结论", sessionRef: makeVerified("mock", "x"), tokens: { input: 1, cached: 0, output: 1 } };
      },
    });
    return { dir, countingResolver, calls: () => n };
  }

  it("summary-written 崩溃点 → 直接完成,不重跑收尾", async () => {
    const { dir, countingResolver, calls } = seedInterrupted("summary-written", { summary: "# 已产出\n\n结论OLD\n" });
    const done = await runTopic(dir, { resolveAdapter: countingResolver, installSignalHandlers: false });
    expect(calls()).toBe(0); // 完全不调裁决人
    expect(done.status).toBe("completed");
    expect(done.outcome).toBeUndefined(); // HEAD-era 无 outcome 的崩溃记录结果未知,不得臆测 success
    expect(done.finalization?.phase).toBe("done");
    expect(fs.readFileSync(path.join(dir, "summary.md"), "utf8")).toContain("结论OLD"); // 已产 summary 保留
  });

  it("summary-written 旧记录即使有累计失败 → 结果仍 unknown", async () => {
    const { dir, countingResolver, calls } = seedInterrupted("summary-written", { summary: "# 已产出\n" });
    const interrupted = loadTopic(dir);
    interrupted.participants[0]!.failures = 1;
    saveTopic(dir, interrupted);

    const done = await runTopic(dir, { resolveAdapter: countingResolver, installSignalHandlers: false });
    expect(calls()).toBe(0);
    expect(done.status).toBe("completed");
    expect(done.outcome).toBeUndefined();
    expect(loadTopic(dir).outcome).toBeUndefined();
  });

  it("pending 且已有本代 verdict → 据其重建,不二次裁决(承接 #6)", async () => {
    const { dir, countingResolver, calls } = seedInterrupted("pending", { verdict: true });
    const done = await runTopic(dir, { resolveAdapter: countingResolver, installSignalHandlers: false });
    expect(calls()).toBe(0); // 不重复调用裁决人
    expect(done.status).toBe("completed");
    expect(done.finalization?.phase).toBe("done");
    expect(fs.readFileSync(path.join(dir, "summary.md"), "utf8")).toContain("先不上 K8s"); // 据旧 verdict 重建
  });

  it("pending 无 verdict → 重跑收尾(裁决恰一次)", async () => {
    const { dir, countingResolver, calls } = seedInterrupted("pending");
    const done = await runTopic(dir, { resolveAdapter: countingResolver, installSignalHandlers: false });
    expect(calls()).toBe(1); // 中途崩、未产 verdict → 补裁决一次
    expect(done.status).toBe("completed");
    expect(done.finalization?.phase).toBe("done");
  });

  it("无 finalization 字段的话题:正常收尾一次,收尾后 phase=done", async () => {
    // 无 finalization → recovering=false,正常进收尾(fresh),不误入恢复分支
    const p1 = writeScript(root, "p1.json", ["立论A"]);
    createTopic(root, {
      id: "t2",
      title: "x",
      mode: "debate",
      maxRounds: 1,
      participants: [{ handle: "mock-1", provider: p1, perspective: "正方" }],
    });
    const dir = path.join(root, "t2");
    let calls = 0;
    const resolver = (spec: string): ProviderAdapter => ({
      ...resolveAdapter(spec),
      async speak() {
        calls += 1;
        return { text: "裁决:结论X", sessionRef: makeVerified("mock", "x"), tokens: { input: 1, cached: 0, output: 1 } };
      },
    });
    const done = await runTopic(dir, { resolveAdapter: resolver, installSignalHandlers: false });
    expect(done.status).toBe("completed");
    expect(done.outcome).toBe("success"); // ①:全成 → success
    expect(done.finalization?.phase).toBe("done"); // fresh 收尾也落显式标记
    expect(done.finalization?.generation).toBe(1);
    expect(calls).toBeGreaterThan(0);
  });

  it("① 有参与者失败但完成 → outcome=degraded", async () => {
    const p1 = writeScript(root, "p1.json", ["立论A"]);
    createTopic(root, {
      id: "deg",
      title: "x",
      mode: "debate",
      maxRounds: 1,
      participants: [{ handle: "mock-1", provider: p1, perspective: "正方" }],
    });
    const dir = path.join(root, "deg");
    // 交锋轮失败一次(bumpFailures→1,未达熔断阈值 3),裁决轮成功 → 完成但 degraded
    let n = 0;
    const resolver = (spec: string): ProviderAdapter => ({
      ...resolveAdapter(spec),
      async speak(o) {
        n += 1;
        if (!o.prompt.includes("裁决任务")) throw new Error("交锋轮挂一次");
        return { text: "裁决:结论X", sessionRef: makeVerified("mock", "x"), tokens: { input: 1, cached: 0, output: 1 } };
      },
    });
    const done = await runTopic(dir, { resolveAdapter: resolver, installSignalHandlers: false });
    expect(done.status).toBe("completed");
    expect(done.outcome).toBe("degraded"); // 有 failures>0 但收尾成功
    expect(done.participants[0]!.failures).toBeGreaterThan(0);
  });
});
