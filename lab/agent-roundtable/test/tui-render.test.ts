import { describe, expect, it } from "vitest";
import type { InboxEntry } from "../src/store/inbox.js";
import type { Topic } from "../src/store/topic.js";
import type { TranscriptEvent } from "../src/store/transcript.js";
import {
  colorMap,
  computeStatusBar,
  parseInput,
  renderEvent,
  renderRows,
} from "../src/tui/render.js";

function ev(partial: Partial<TranscriptEvent> & Pick<TranscriptEvent, "seq" | "kind" | "round">): TranscriptEvent {
  return { ts: "t", ...partial };
}

describe("parseInput", () => {
  it("classifies blank / :stop / :quit / say", () => {
    expect(parseInput("")).toEqual({ type: "noop" });
    expect(parseInput("   ")).toEqual({ type: "noop" });
    expect(parseInput(":stop")).toEqual({ type: "stop" });
    expect(parseInput(":q")).toEqual({ type: "quit" });
    expect(parseInput(":quit")).toEqual({ type: "quit" });
    expect(parseInput("  补充一个约束 ")).toEqual({ type: "say", body: "补充一个约束" });
  });

  it("does not treat text containing :stop as a stop command", () => {
    expect(parseInput("请不要 :stop")).toEqual({ type: "say", body: "请不要 :stop" });
  });
});

describe("colorMap", () => {
  it("assigns stable colors in first-seen order and wraps past palette", () => {
    const froms = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const events = froms.map((from, i) => ev({ seq: i + 1, kind: "message", round: 1, from }));
    const map = colorMap(events);
    expect(map.get("a")).toBe("green");
    expect(map.get("b")).toBe("cyan");
    // 第 9 个(index 8)回绕到调色板首位
    expect(map.get("i")).toBe(map.get("a"));
  });

  it("ignores system / human / round_end when assigning speaker colors", () => {
    const events = [
      ev({ seq: 1, kind: "system", round: 0, body: "开始" }),
      ev({ seq: 2, kind: "human", round: 1, from: "cecil", body: "hi" }),
      ev({ seq: 3, kind: "message", round: 1, from: "claude-1", body: "x" }),
    ];
    const map = colorMap(events);
    expect(map.has("cecil")).toBe(false);
    expect(map.get("claude-1")).toBe("green");
  });
});

describe("renderEvent", () => {
  const colorOf = (): string | undefined => "green";
  it("renders each kind with distinct styling", () => {
    expect(renderEvent(ev({ seq: 1, kind: "system", round: 0, body: "开题" }), colorOf)).toMatchObject({
      text: "* 开题",
      dim: true,
    });
    expect(renderEvent(ev({ seq: 2, kind: "message", round: 1, from: "a", body: "正文" }), colorOf)).toMatchObject({
      text: "[R1] a: 正文",
      color: "green",
    });
    expect(renderEvent(ev({ seq: 3, kind: "human", round: 1, from: "cecil", body: "插" }), colorOf)).toMatchObject({
      text: "[R1] cecil(插话): 插",
      color: "yellow",
      bold: true,
    });
    expect(renderEvent(ev({ seq: 4, kind: "skip", round: 2, from: "a" }), colorOf)).toMatchObject({
      text: "[R2] a: 【跳过】",
      dim: true,
    });
    expect(renderEvent(ev({ seq: 5, kind: "verdict", round: 4, from: "judge", body: "裁" }), colorOf)).toMatchObject({
      text: "[R4] judge(裁决): 裁",
      color: "cyanBright",
      bold: true,
    });
    expect(renderEvent(ev({ seq: 6, kind: "round_end", round: 1 }), colorOf)).toMatchObject({
      text: "[R1] —— 本轮结束 ——",
      dim: true,
    });
  });
});

describe("renderRows", () => {
  it("appends pending say entries as dim yellow rows after transcript rows", () => {
    const events = [ev({ seq: 1, kind: "message", round: 1, from: "a", body: "hi" })];
    const pending: InboxEntry[] = [{ id: 3, ts: "t", kind: "say", from: "cecil", body: "待发送插话" }];
    const rows = renderRows(events, pending);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: "t1", color: "green" });
    expect(rows[1]).toMatchObject({
      key: "p3",
      text: "cecil(插话·待发送): 待发送插话",
      color: "yellow",
      dim: true,
    });
  });
});

describe("computeStatusBar", () => {
  function topic(over: Partial<Topic> = {}): Topic {
    return {
      version: 1,
      id: "t",
      title: "缓存选型",
      mode: "debate",
      status: "active",
      maxRounds: 3,
      currentRound: 1,
      createdAt: "t",
      participants: [
        {
          handle: "a",
          provider: "mock",
          transport: "local",
          perspective: "架构",
          model: null,
          sessionRef: null,
          tokens: { input: 100, cached: 0, output: 40 },
          failures: 0,
        },
        {
          handle: "b",
          provider: "mock",
          transport: "local",
          perspective: "成本",
          model: null,
          sessionRef: null,
          tokens: { input: 60, cached: 0, output: 10 },
          failures: 0,
        },
      ],
      ...over,
    };
  }

  it("sums tokens across participants and formats round progress", () => {
    const view = computeStatusBar(topic(), true);
    expect(view).toEqual({
      title: "缓存选型",
      mode: "debate",
      round: "1/3",
      runner: "运行中",
      tokens: 210,
    });
  });

  it("reports runner state from lock and completion status", () => {
    expect(computeStatusBar(topic({ status: "paused" }), false).runner).toBe("未运行");
    expect(computeStatusBar(topic({ status: "completed" }), false).runner).toBe("已完成");
    expect(computeStatusBar(topic({ status: "completed" }), true).runner).toBe("运行中");
  });
});
