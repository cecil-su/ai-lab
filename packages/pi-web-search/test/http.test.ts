import { describe, expect, it } from "vitest";
import { fetchPage } from "../src/http.ts";
import { SearchTimeoutError } from "../src/types.ts";

describe("bounded HTTP", () => {
  it("preserves a caller abort reason", async () => {
    const controller = new AbortController();
    const reason = new Error("user cancelled");
    controller.abort(reason);
    await expect(fetchPage("https://example.test", {
      signal: controller.signal,
      timeoutMs: 100,
      scope: "test",
      fetch: async () => new Response("never"),
    })).rejects.toBe(reason);
  });

  it("times out even when fetch ignores its signal", async () => {
    const never = new Promise<Response>(() => {});
    await expect(fetchPage("https://example.test", {
      timeoutMs: 20,
      scope: "slow test",
      fetch: () => never,
    })).rejects.toBeInstanceOf(SearchTimeoutError);
  });

  it("cancels the response reader when aborted mid-body", async () => {
    const controller = new AbortController();
    const pullStarted = Promise.withResolvers<void>();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode("first"));
      },
      pull() {
        pullStarted.resolve();
        return new Promise(() => {});
      },
      cancel() {
        cancelled = true;
      },
    });
    const reason = new Error("escape");
    const pending = fetchPage("https://example.test", {
      signal: controller.signal,
      timeoutMs: 500,
      scope: "stream test",
      fetch: async () => new Response(stream),
    });
    await pullStarted.promise;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(cancelled).toBe(true);
  });

  it("rejects an oversized streamed body", async () => {
    await expect(fetchPage("https://example.test", {
      timeoutMs: 100,
      maxBytes: 4,
      scope: "large test",
      fetch: async () => new Response("12345"),
    })).rejects.toThrow("exceeded 4 bytes");
  });
});
