import { describe, expect, it, vi } from "vitest";
import { executeWebSearch } from "../src/search.ts";
import type { PublicSearchResult } from "../src/public.ts";
import { SearchTimeoutError } from "../src/types.ts";

const publicResult: PublicSearchResult = {
  sources: [{ title: "public", url: "https://public.example", engines: ["mojeek"], engineCount: 1 }],
  engineAttempts: [{ engine: "mojeek", outcome: "success", resultCount: 1, durationMs: 1 }],
};

describe("search orchestration", () => {
  it("uses Brave without public fan-out when Brave succeeds", async () => {
    const publicSearch = vi.fn(async () => publicResult);
    const result = await executeWebSearch({ query: "current" }, undefined, {
      config: { mode: "auto", braveApiKey: "secret" },
      brave: async () => [{ title: "brave", url: "https://brave.example" }],
      public: publicSearch,
    });
    expect(result.details.provider).toBe("brave");
    expect(publicSearch).not.toHaveBeenCalled();
    expect(JSON.stringify(result.details)).not.toContain("secret");
  });

  it("falls back after a Brave error and redacts the configured key", async () => {
    const result = await executeWebSearch({ query: "current" }, undefined, {
      config: { mode: "auto", braveApiKey: "secret" },
      brave: async () => { throw new Error("upstream echoed secret"); },
      public: async () => publicResult,
    });
    expect(result.details.provider).toBe("public");
    expect(result.details.attempts.map(item => item.outcome)).toEqual(["error", "success"]);
    expect(JSON.stringify(result.details)).not.toContain("secret");
  });

  it("falls back after Brave returns empty", async () => {
    const result = await executeWebSearch({ query: "current" }, undefined, {
      config: { mode: "auto", braveApiKey: "key" },
      brave: async () => [],
      public: async () => publicResult,
    });
    expect(result.details.attempts.map(item => item.outcome)).toEqual(["empty", "success"]);
  });

  it("falls back after an internal Brave timeout", async () => {
    const result = await executeWebSearch({ query: "current" }, undefined, {
      config: { mode: "auto", braveApiKey: "key" },
      brave: async () => { throw new SearchTimeoutError("Brave search"); },
      public: async () => publicResult,
    });
    expect(result.details.attempts.map(item => item.outcome)).toEqual(["timeout", "success"]);
  });

  it("returns normal empty output when public search completes empty", async () => {
    const result = await executeWebSearch({ query: "nothing" }, undefined, {
      config: { mode: "public" },
      public: async () => ({ sources: [], engineAttempts: [] }),
    });
    expect(result.details.sources).toEqual([]);
    expect(result.details.attempts[0].outcome).toBe("empty");
    expect(result.content[0].text).toContain("No results found");
  });

  it("throws when every provider path fails operationally", async () => {
    await expect(executeWebSearch({ query: "current" }, undefined, {
      config: { mode: "auto", braveApiKey: "key" },
      brave: async () => { throw new Error("brave down"); },
      public: async () => { throw new Error("public down"); },
    })).rejects.toThrow("Web search unavailable");
  });

  it("goes directly to public without a key", async () => {
    const brave = vi.fn();
    const result = await executeWebSearch({ query: "current" }, undefined, {
      config: { mode: "auto" }, brave, public: async () => publicResult,
    });
    expect(brave).not.toHaveBeenCalled();
    expect(result.details.provider).toBe("public");
  });

  it("preserves caller cancellation and never starts fallback", async () => {
    const controller = new AbortController();
    const publicSearch = vi.fn(async () => publicResult);
    const reason = new Error("escape");
    const promise = executeWebSearch({ query: "current" }, controller.signal, {
      config: { mode: "auto", braveApiKey: "secret" },
      brave: () => new Promise(() => {}),
      public: publicSearch,
      timings: { wholeMs: 200 },
    });
    controller.abort(reason);
    await expect(promise).rejects.toBe(reason);
    expect(publicSearch).not.toHaveBeenCalled();
  });

  it("enforces the whole-tool budget when an injected provider ignores signals", async () => {
    await expect(executeWebSearch({ query: "current" }, undefined, {
      config: { mode: "auto", braveApiKey: "secret" },
      brave: () => new Promise(() => {}),
      timings: { wholeMs: 20 },
    })).rejects.toThrow("Web search timed out");
  });

  it("rejects invalid operator mode before network work", async () => {
    await expect(executeWebSearch({ query: "current" }, undefined, {
      env: { PI_WEB_SEARCH_MODE: "invalid" },
    })).rejects.toThrow("PI_WEB_SEARCH_MODE");
  });

  it("centrally filters constraints", async () => {
    const result = await executeWebSearch({ query: "docs site:example.com" }, undefined, {
      config: { mode: "public" },
      public: async () => ({ ...publicResult, sources: [
        { title: "keep", url: "https://example.com/x", engines: ["mojeek"], engineCount: 1 },
        { title: "drop", url: "https://other.test/x", engines: ["mojeek"], engineCount: 1 },
      ] }),
    });
    expect(result.details.sources.map(source => source.title)).toEqual(["keep"]);
  });
});
