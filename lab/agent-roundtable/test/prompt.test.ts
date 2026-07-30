import { describe, expect, it } from "vitest";
import {
  buildDeltaPrompt,
  buildPrompt,
  clampQuote,
  deltaContext,
  extractStance,
  isSkip,
  lastOwnSeq,
  stanceDigest,
  truncateBody,
} from "../src/engine/prompt.js";
import type { TranscriptEvent } from "../src/store/transcript.js";

describe("stance extraction (pure)", () => {
  it("extracts the last 【立场】 line content", () => {
    expect(extractStance("正文一\n正文二\n【立场】我支持方案 A")).toBe("我支持方案 A");
  });

  it("takes the tail-most stance when multiple appear", () => {
    expect(extractStance("【立场】旧\n中间\n【立场】新")).toBe("新");
  });

  it("returns null when missing", () => {
    expect(extractStance("只有正文,没有立场行")).toBeNull();
  });

  it("truncateBody collapses whitespace and caps length", () => {
    expect(truncateBody("  a\n\nb   c  ")).toBe("a b c");
    expect(truncateBody("x".repeat(200), 10)).toBe("xxxxxxxxxx…");
  });

  it("stanceDigest prefers stance, falls back to truncation", () => {
    expect(stanceDigest("正文\n【立场】就这样")).toBe("就这样");
    expect(stanceDigest("没有立场的长正文")).toBe("没有立场的长正文");
  });

  it("isSkip detects the skip marker", () => {
    expect(isSkip("【跳过】")).toBe(true);
    expect(isSkip("我有话说\n【立场】继续")).toBe(false);
  });
});

describe("buildPrompt assembly", () => {
  const base = {
    charter: "# 话题:缓存选型\n## 议题\n缓存选型",
    self: { handle: "claude-1", perspective: "系统架构师视角" },
    round: 3,
    maxRounds: 3,
    stanceSummary: [
      { round: 1, from: "claude-1", stance: "选 Redis" },
      { round: 1, from: "codex-1", stance: "选内存" },
    ],
    recent: [
      { from: "claude-1", body: "第二轮我仍主张 Redis\n【立场】选 Redis", kind: "message" as const },
      { from: "cecil", body: "补充:预算有限", kind: "human" as const },
    ],
  };

  it("orders sections: charter → 历史立场摘要 → 最近发言 → 身份 → 发言协议", () => {
    const out = buildPrompt(base);
    const idx = (s: string): number => out.indexOf(s);
    expect(idx("# 话题:缓存选型")).toBe(0);
    expect(idx("## 历史立场摘要")).toBeGreaterThan(idx("# 话题:缓存选型"));
    expect(idx("## 最近发言")).toBeGreaterThan(idx("## 历史立场摘要"));
    expect(idx("## 你的身份")).toBeGreaterThan(idx("## 最近发言"));
    expect(idx("## 发言协议")).toBeGreaterThan(idx("## 你的身份"));
  });

  it("renders stance summary lines and human interjection tag", () => {
    const out = buildPrompt(base);
    expect(out).toContain("- 第1轮 claude-1:【立场】选 Redis");
    expect(out).toContain("### cecil(人类插话)");
    expect(out).toContain("你是「claude-1」,视角:系统架构师视角");
    expect(out).toContain("现在是第 3 / 最多 3 轮讨论");
  });

  it("shows a first-round placeholder when no recent speeches", () => {
    const out = buildPrompt({ ...base, round: 1, stanceSummary: [], recent: [] });
    expect(out).not.toContain("## 历史立场摘要");
    expect(out).toContain("(本轮为首轮,暂无历史发言)");
  });
});

describe("increment prompt (R4b)", () => {
  const ev = (seq: number, from: string, kind: TranscriptEvent["kind"], body?: string): TranscriptEvent => ({
    seq,
    ts: "",
    round: 1,
    from,
    kind,
    ...(body !== undefined ? { body } : {}),
  });

  it("lastOwnSeq 取该 handle 最近的 message/skip seq,从未发言为 0", () => {
    const events = [
      ev(1, "a", "message", "A1"),
      ev(2, "b", "message", "B1"),
      ev(3, "a", "skip"),
      ev(4, "b", "message", "B2"),
    ];
    expect(lastOwnSeq(events, "a")).toBe(3);
    expect(lastOwnSeq(events, "b")).toBe(4);
    expect(lastOwnSeq(events, "c")).toBe(0);
  });

  it("deltaContext 只取 sinceSeq 之后、有正文的发言", () => {
    const events = [
      ev(1, "a", "message", "A1"),
      ev(2, "b", "message", "B1"),
      ev(3, "a", "message", "A2"),
      ev(4, "c", "human", "插话"),
      ev(5, "x", "round_end"), // 无 from/body → 排除
    ];
    const delta = deltaContext(events, 1);
    expect(delta.map((d) => d.body)).toEqual(["B1", "A2", "插话"]);
  });

  it("buildDeltaPrompt 只含新增+身份+协议,不含 charter/历史", () => {
    const out = buildDeltaPrompt({
      self: { handle: "claude-1", perspective: "架构" },
      round: 2,
      maxRounds: 3,
      newSpeeches: [{ from: "codex-1", body: "上一轮我反对\n【立场】反对", kind: "message" }],
    });
    expect(out).toContain("## 最新进展(你上次发言后)");
    expect(out).toContain("### codex-1");
    expect(out).toContain("你是「claude-1」");
    expect(out).toContain("现在是第 2 / 最多 3 轮讨论");
    expect(out).not.toContain("## 参考材料");
    expect(out).not.toContain("## 历史立场摘要");
  });

  it("clampQuote 超长截断", () => {
    expect(clampQuote("x".repeat(10), 5)).toBe("xxxxx\n…(已截断)");
    expect(clampQuote("短", 5)).toBe("短");
  });
});
