import { describe, expect, it } from "vitest";
import { makeDegraded, makeVerified } from "../src/adapters/types.js";
import { rebuildFromTranscript } from "../src/engine/runner.js";
import type { TranscriptEvent } from "../src/store/transcript.js";

function ev(partial: Partial<TranscriptEvent> & Pick<TranscriptEvent, "seq" | "kind" | "round">): TranscriptEvent {
  return { ts: "t", ...partial };
}

describe("rebuildFromTranscript (Phase-3 ①)", () => {
  it("无带 commit 的事件(旧数据)→ null,调用方保留 checkpoint", () => {
    const events = [
      ev({ seq: 1, kind: "system", round: 0, body: "开题" }),
      ev({ seq: 2, kind: "message", round: 1, from: "a", body: "旧版无 commit" }),
    ];
    expect(rebuildFromTranscript(events, "a")).toBeNull();
    expect(rebuildFromTranscript(events, "b")).toBeNull();
  });

  it("取最后一个 commit(累计值,message/skip 均计入)", () => {
    const events = [
      ev({ seq: 1, kind: "message", round: 1, from: "a", body: "一", commit: { sessionRef: makeVerified("mock", "1"), tokens: { input: 10, cached: 0, output: 5 } } }),
      ev({ seq: 2, kind: "skip", round: 1, from: "a", commit: { sessionRef: makeVerified("mock", "2"), tokens: { input: 20, cached: 0, output: 5 } } }),
      ev({ seq: 3, kind: "message", round: 2, from: "b", body: "无关", commit: { sessionRef: makeVerified("mock", "x"), tokens: { input: 1, cached: 0, output: 1 } } }),
    ];
    const rebuilt = rebuildFromTranscript(events, "a")!;
    expect(rebuilt.sessionRef?.value).toBe("2");
    expect(rebuilt.tokens).toEqual({ input: 20, cached: 0, output: 5 });
    expect(rebuilt.failures).toBe(0);
  });

  it("error commit 作废会话(sessionRef:null),failures 按 error 计数", () => {
    const events = [
      ev({ seq: 1, kind: "message", round: 1, from: "a", body: "ok", commit: { sessionRef: makeVerified("mock", "1"), tokens: { input: 10, cached: 0, output: 5 } } }),
      ev({ seq: 2, kind: "error", round: 1, from: "a", body: "provider 挂了", commit: { sessionRef: null, tokens: { input: 10, cached: 0, output: 5 } } }),
      ev({ seq: 3, kind: "error", round: 1, from: "a", body: "又挂", commit: { sessionRef: null, tokens: { input: 10, cached: 0, output: 5 } } }),
    ];
    const rebuilt = rebuildFromTranscript(events, "a")!;
    expect(rebuilt.sessionRef).toBeNull(); // 会话已作废 → 下轮全量新会话
    expect(rebuilt.tokens).toEqual({ input: 10, cached: 0, output: 5 }); // 失败不累计 token
    expect(rebuilt.failures).toBe(2);
  });

  it("降级哨兵 ref 原样重建(trust 由 canResume 闸门判定)", () => {
    const events = [
      ev({ seq: 1, kind: "message", round: 1, from: "a", body: "x", commit: { sessionRef: makeDegraded("reasonix", "@last"), tokens: { input: 1, cached: 0, output: 1 } } }),
    ];
    expect(rebuildFromTranscript(events, "a")!.sessionRef?.trust).toBe("degraded");
  });
});
