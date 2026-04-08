import { describe, it, expect } from "vitest";
import {
  normalizeUrl,
  getDeduplicationKey,
  deduplicateItems,
  loadSeen,
  type SeenIndex,
} from "../dedup.js";
import type { FeedItem } from "../fetchers/types.js";

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "",
    title: "Test Title",
    url: "https://example.com/post",
    content: "content",
    date: null,
    ...overrides,
  };
}

describe("normalizeUrl", () => {
  it("removes utm params", () => {
    expect(normalizeUrl("https://example.com/post?utm_source=rss&utm_medium=feed"))
      .toBe("https://example.com/post");
  });

  it("removes trailing slash", () => {
    expect(normalizeUrl("https://example.com/post/"))
      .toBe("https://example.com/post");
  });

  it("lowercases hostname", () => {
    expect(normalizeUrl("https://EXAMPLE.COM/Post"))
      .toBe("https://example.com/Post");
  });

  it("sorts query params", () => {
    expect(normalizeUrl("https://example.com?b=2&a=1"))
      .toBe("https://example.com/?a=1&b=2");
  });

  it("returns raw string for invalid URLs", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("getDeduplicationKey", () => {
  it("prefers guid over url", () => {
    const key = getDeduplicationKey(makeItem({ id: "abc123", url: "https://example.com" }));
    expect(key).toBe("guid:abc123");
  });

  it("falls back to normalized url", () => {
    const key = getDeduplicationKey(makeItem({ id: "", url: "https://EXAMPLE.com/post/" }));
    expect(key).toBe("url:https://example.com/post");
  });

  it("falls back to title hash", () => {
    const key = getDeduplicationKey(makeItem({ id: "", url: "", title: "My Title" }));
    expect(key).toMatch(/^title:[a-f0-9]{8}$/);
  });

  it("returns empty string when all fields empty", () => {
    const key = getDeduplicationKey(makeItem({ id: "", url: "", title: "" }));
    expect(key).toBe("");
  });
});

describe("deduplicateItems", () => {
  it("filters out already seen items", () => {
    const seen: SeenIndex = { "test-source": ["guid:abc"] };
    const items = [
      makeItem({ id: "abc" }),
      makeItem({ id: "def" }),
    ];
    const result = deduplicateItems(items, "test-source", seen);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("def");
  });

  it("adds new keys to seen index", () => {
    const seen: SeenIndex = {};
    const items = [makeItem({ id: "new1" }), makeItem({ id: "new2" })];
    deduplicateItems(items, "src", seen);
    expect(seen["src"]).toEqual(["guid:new1", "guid:new2"]);
  });

  it("enforces FIFO 500 limit", () => {
    const existingKeys = Array.from({ length: 499 }, (_, i) => `guid:old-${i}`);
    const seen: SeenIndex = { "src": existingKeys };
    const items = [makeItem({ id: "new1" }), makeItem({ id: "new2" })];
    deduplicateItems(items, "src", seen);
    // 499 + 2 = 501 → trimmed to 500
    expect(seen["src"]).toHaveLength(500);
    // oldest key should be removed
    expect(seen["src"][0]).toBe("guid:old-1");
    expect(seen["src"][499]).toBe("guid:new2");
  });

  it("skips items with empty dedup key", () => {
    const seen: SeenIndex = {};
    const items = [makeItem({ id: "", url: "", title: "" })];
    const result = deduplicateItems(items, "src", seen);
    expect(result).toHaveLength(0);
  });
});

describe("loadSeen", () => {
  it("returns empty object for non-existent file", async () => {
    const result = await loadSeen("/tmp/nonexistent-seen-file.json");
    expect(result).toEqual({});
  });
});
