import { describe, expect, it } from "vitest";
import { mergePublicSources, searchPublic } from "../src/public.ts";
import { parseSearchQuery } from "../src/query.ts";
import type { PublicEngineId, SearchRequest } from "../src/types.ts";

function request(signal?: AbortSignal): SearchRequest {
  const query = "test";
  return { query, parsedQuery: parseSearchQuery(query), limit: 10, signal, fetch, timeoutMs: 100 };
}

const failing = (message: string) => async () => { throw new Error(message); };

describe("public aggregate", () => {
  it("counts one vote per engine and ranks consensus first", () => {
    const responses = new Map<PublicEngineId, Array<{ title: string; url: string; snippet?: string }>>([
      ["startpage", [
        { title: "shared", url: "https://www.example.com/shared/", snippet: "short" },
        { title: "same engine duplicate", url: "https://example.com/shared" },
        { title: "single", url: "https://one.example/x" },
      ]],
      ["duckduckgo", [{ title: "shared ddg", url: "https://example.com/shared", snippet: "longer snippet" }]],
      ["mojeek", [{ title: "other", url: "https://two.example/x" }]],
    ]);
    const merged = mergePublicSources(responses, 10);
    expect(merged[0]).toMatchObject({ engineCount: 2, engines: ["startpage", "duckduckgo"], snippet: "longer snippet" });
  });

  it("keeps distinct non-default ports separate", () => {
    const responses = new Map<PublicEngineId, Array<{ title: string; url: string }>>([
      ["startpage", [{ title: "a", url: "https://example.com:8443/x" }]],
      ["duckduckgo", [{ title: "b", url: "https://example.com:9443/x" }]],
    ]);
    expect(mergePublicSources(responses, 10)).toHaveLength(2);
  });

  it("returns a normal empty result when every engine completes empty", async () => {
    const empty = async () => [];
    const result = await searchPublic(request(), {
      deadlines: { softMs: 5, hardMs: 20, requestMs: 15 },
      runners: { startpage: empty, duckduckgo: empty, mojeek: empty },
    });
    expect(result.sources).toEqual([]);
    expect(result.engineAttempts.map(item => item.outcome)).toEqual(["empty", "empty", "empty"]);
  });

  it("returns at the soft deadline and aborts a straggler", async () => {
    let aborted = false;
    const started = Date.now();
    const result = await searchPublic(request(), {
      deadlines: { softMs: 20, hardMs: 100, requestMs: 80 },
      runners: {
        startpage: async () => [{ title: "fast", url: "https://example.com" }],
        duckduckgo: async req => new Promise((_resolve, reject) => req.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(req.signal?.reason);
        }, { once: true })),
        mojeek: async () => [],
      },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    expect(Date.now() - started).toBeLessThan(90);
    expect(result.sources).toHaveLength(1);
    expect(aborted).toBe(true);
  });

  it("waits past soft deadline for the first non-empty result", async () => {
    const started = Date.now();
    const result = await searchPublic(request(), {
      deadlines: { softMs: 5, hardMs: 100, requestMs: 80 },
      runners: {
        startpage: async () => [],
        duckduckgo: async () => {
          await new Promise(resolve => setTimeout(resolve, 25));
          return [{ title: "late", url: "https://example.com" }];
        },
        mojeek: failing("blocked"),
      },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    expect(result.sources[0].title).toBe("late");
  });

  it("enforces the hard cap when every runner hangs", async () => {
    const started = Date.now();
    const never = () => new Promise<never>(() => {});
    await expect(searchPublic(request(), {
      deadlines: { softMs: 5, hardMs: 25, requestMs: 100 },
      runners: { startpage: never, duckduckgo: never, mojeek: never },
    })).rejects.toThrow("All public engines failed");
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("returns surviving results and records every engine", async () => {
    const result = await searchPublic(request(), {
      deadlines: { softMs: 5, hardMs: 40, requestMs: 30 },
      runners: {
        startpage: failing("blocked"),
        duckduckgo: async () => [{ title: "ok", url: "https://example.com" }],
        mojeek: () => new Promise(() => {}),
      },
    });
    expect(result.sources).toHaveLength(1);
    expect(result.engineAttempts).toHaveLength(3);
    expect(result.engineAttempts.find(item => item.engine === "mojeek")?.outcome).toBe("timeout");
  });

  it("preserves caller cancellation even when runners ignore signals", async () => {
    const controller = new AbortController();
    const reason = new Error("escape");
    const never = () => new Promise<never>(() => {});
    const pending = searchPublic(request(controller.signal), {
      deadlines: { softMs: 100, hardMs: 200, requestMs: 150 },
      runners: { startpage: never, duckduckgo: never, mojeek: never },
    });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("throws when every engine fails", async () => {
    await expect(searchPublic(request(), {
      deadlines: { softMs: 1, hardMs: 10, requestMs: 5 },
      runners: {
        startpage: failing("a"),
        duckduckgo: failing("b"),
        mojeek: failing("c"),
      },
    })).rejects.toThrow("All public engines failed");
  });
});
