import { describe, expect, it } from "vitest";
import { extractJsonArray } from "../src/engine/audit.js";

describe("audit 语义抽检解析 (体验 C)", () => {
  it("提取模型回答中的 JSON 数组(容忍前后说明文字)", () => {
    const text = `好的,以下是抽检结果:
[{"claim":"结论一","verdict":"support","reason":"[seq 3] 支撑"}]
以上为全部判定。`;
    const parsed = extractJsonArray(text) as { claim: string; verdict: string }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ claim: "结论一", verdict: "support" });
  });

  it("无 JSON 数组 → 抛错", () => {
    expect(() => extractJsonArray("模型说了一堆没有数组的话")).toThrow(/JSON 数组/);
  });

  it("提取中间嵌入的数组(多段文字)", () => {
    const text = "前置说明\n[{},{}]\n后置说明";
    expect(extractJsonArray(text)).toHaveLength(2);
  });
});
