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

  it("传 contextMaterial 时注入参考材料段,在停止条件之前", () => {
    const md = buildCharter({
      title: "缓存选型",
      mode: "roundtable",
      maxRounds: 3,
      participants,
      contextMaterial: "## 参考材料\n### foo.ts\n```ts\nconst x = 1;\n```",
    });
    expect(md).toContain("## 参考材料");
    expect(md).toContain("const x = 1;");
    expect(md.indexOf("## 参考材料")).toBeLessThan(md.indexOf("## 停止条件"));
  });

  it("不传 contextMaterial 时不出现参考材料段", () => {
    const md = buildCharter({ title: "缓存选型", mode: "roundtable", maxRounds: 3, participants });
    expect(md).not.toContain("## 参考材料");
  });

  it("传 transcriptRef(F4②)加可选自读资源段,opt-in 措辞、非每轮强制读", () => {
    const md = buildCharter({
      title: "缓存选型",
      mode: "roundtable",
      maxRounds: 3,
      participants,
      transcriptRef: "./transcript.jsonl",
    });
    expect(md).toContain("## 讨论记录(可选自读)");
    expect(md).toContain("./transcript.jsonl");
    expect(md).toContain("无需读它");
    expect(md).not.toContain("每轮"); // 不是每轮强制读 → 不双份烧 token
  });

  it("不传 transcriptRef 时无自读资源段", () => {
    const md = buildCharter({ title: "缓存选型", mode: "roundtable", maxRounds: 3, participants });
    expect(md).not.toContain("## 讨论记录(可选自读)");
  });
});
