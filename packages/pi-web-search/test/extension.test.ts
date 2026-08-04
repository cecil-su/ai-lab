import { describe, expect, it, vi } from "vitest";
import { registerWebSearchTool } from "../extensions/index.ts";

describe("Pi extension", () => {
  it("registers exactly web_search and forwards signal identity", async () => {
    const registerTool = vi.fn();
    const signal = new AbortController().signal;
    registerWebSearchTool(
      { registerTool } as never,
      {},
      async (_input, receivedSignal) => {
        expect(receivedSignal).toBe(signal);
        return {
          content: [{ type: "text", text: "No results found." }],
          details: {
            schemaVersion: 1, mode: "public", provider: "public", sources: [], attempts: [],
            engineAttempts: [], relaxedConstraints: [], elapsedMs: 0, truncated: false,
          },
        };
      },
    );
    expect(registerTool).toHaveBeenCalledTimes(1);
    const tool = registerTool.mock.calls[0][0];
    expect(tool.name).toBe("web_search");
    const result = await tool.execute("id", { query: "test", limit: 3 }, signal);
    expect(result.details.schemaVersion).toBe(1);
  });
});
