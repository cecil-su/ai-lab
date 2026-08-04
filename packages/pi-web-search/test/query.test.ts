import { describe, expect, it } from "vitest";
import { applyQueryConstraints, formatScraperQuery, parseDateValue, parseSearchQuery } from "../src/query.ts";

const sources = [
  { title: "中文文档", url: "https://docs.example.com/guide.pdf", snippet: "安装说明" },
  { title: "Other", url: "https://other.example/post", publishedDate: "2023-01-01" },
];

describe("query pipeline", () => {
  it("preserves plain Chinese queries", () => {
    const raw = "大模型 最新进展";
    const parsed = parseSearchQuery(raw);
    expect(parsed.text).toBe(raw);
    expect(parsed.hasDirectives).toBe(false);
    expect(formatScraperQuery(raw, parsed)).toBe(raw);
  });

  it("keeps lang tokens literal", () => {
    const parsed = parseSearchQuery("搜索 lang:zh language:en");
    expect(parsed.hasDirectives).toBe(false);
    expect(parsed.text).toBe("搜索 lang:zh language:en");
  });

  it("filters supported constraints and relaxes empty dimensions", () => {
    const parsed = parseSearchQuery("install site:docs.example.com filetype:docx");
    const result = applyQueryConstraints(sources, parsed);
    expect(result.sources.map(source => source.url)).toEqual(["https://docs.example.com/guide.pdf"]);
    expect(result.dropped).toEqual(["filetype:docx"]);
  });

  it("rejects impossible dates and accepts leap days", () => {
    expect(parseDateValue("2024-02-31")).toBeUndefined();
    expect(parseDateValue("2023-02-29")).toBeUndefined();
    expect(parseDateValue("2024-02-29")).toBe("2024-02-29");
    expect(parseSearchQuery("release before:2024-02-31").text).toBe("release before:2024-02-31");
  });

  it("uses an injected clock for relative dates", () => {
    const parsed = parseSearchQuery("news before:2020-01-01");
    const now = Date.parse("2026-01-01T00:00:00Z");
    const result = applyQueryConstraints([
      { title: "recent", url: "https://example.com/recent", publishedDate: "2 days ago" },
      { title: "old", url: "https://example.com/old", publishedDate: "2019-01-01" },
    ], parsed, now);
    expect(result.sources.map(source => source.title)).toEqual(["old"]);
  });
});
