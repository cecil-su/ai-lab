import { describe, it, expect } from "vitest";
import {
  PERSPECTIVE_TEMPLATES,
  resolvePerspectiveText,
  buildCharter,
} from "../src/engine/charter.js";

describe("perspective templates (R6)", () => {
  it("内置 6 个视角模板", () => {
    expect(Object.keys(PERSPECTIVE_TEMPLATES).sort()).toEqual(
      ["architect", "cost", "pragmatist", "redteam", "security", "ux"],
    );
  });

  it("命中模板取模板文,未命中按自由文本透传,对象取 custom", () => {
    expect(resolvePerspectiveText("security")).toBe(PERSPECTIVE_TEMPLATES.security);
    expect(resolvePerspectiveText("只盯数据库锁竞争")).toBe("只盯数据库锁竞争");
    expect(resolvePerspectiveText({ custom: "只盯 API 兼容性" })).toBe("只盯 API 兼容性");
  });
});

describe("buildCharter", () => {
  const participants = [
    { handle: "claude-1", providerBase: "claude", perspective: "architect" },
    { handle: "codex-1", providerBase: "codex", perspective: "redteam" },
  ];

  it("roundtable charter 含议题/模式/参与者/停止条件,无裁决安排", () => {
    const md = buildCharter({ title: "缓存选型", mode: "roundtable", maxRounds: 3, participants });
    expect(md).toContain("# 话题:缓存选型");
    expect(md).toContain("## 停止条件");
    expect(md).toContain(PERSPECTIVE_TEMPLATES.architect);
    expect(md).not.toContain("## 裁决安排");
  });

  it("debate charter 含裁决安排,裁决人取首位 provider", () => {
    const md = buildCharter({ title: "缓存选型", mode: "debate", maxRounds: 2, participants });
    expect(md).toContain("## 裁决安排");
    expect(md).toContain("claude-judge");
  });
});
