import { describe, expect, it } from "vitest";
import { formatWebSearchResult } from "../src/format.ts";

describe("result formatting", () => {
  it("keeps text indexes aligned with JSON-safe details", () => {
    const result = formatWebSearchResult({
      mode: "public",
      provider: "public",
      sources: [{ title: "Title", url: "https://example.com", snippet: "Snippet", engines: ["mojeek"], engineCount: 1 }],
      attempts: [{ provider: "public", outcome: "success", resultCount: 1, durationMs: 1 }],
      engineAttempts: [],
      relaxedConstraints: [],
      elapsedMs: 2,
    });
    expect(result.content[0].text).toContain("[1] Title");
    expect(result.details.sources[0].index).toBe(1);
    expect(JSON.parse(JSON.stringify(result.details))).toEqual(result.details);
  });

  it("drops complete trailing entries when details exceed the cap", () => {
    const sources = Array.from({ length: 20 }, (_, index) => ({
      title: `Title ${index}`,
      url: `https://example.com/${index}?q=${"x".repeat(1900)}`,
      snippet: "s".repeat(240),
      engines: ["mojeek" as const],
      engineCount: 1,
    }));
    const result = formatWebSearchResult({
      mode: "public", provider: "public", sources,
      attempts: [], engineAttempts: [], relaxedConstraints: [], elapsedMs: 1,
    });
    expect(result.details.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(result.details)).byteLength).toBeLessThanOrEqual(32 * 1024);
    expect(result.details.sources.at(-1)?.index).toBe(result.details.sources.length);
  });
});
