import { describe, expect, it } from "vitest";
import { executeWebSearch } from "../src/search.ts";

const enabled = process.env.PI_WEB_SEARCH_LIVE === "1";

describe.skipIf(!enabled)("live web search", () => {
  it("returns at least one bounded source", async () => {
    const result = await executeWebSearch({ query: "Pi coding agent", limit: 3 });
    expect(result.details.sources.length).toBeGreaterThan(0);
  }, 35_000);
});
