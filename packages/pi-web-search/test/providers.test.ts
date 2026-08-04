import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { searchBrave } from "../src/providers/brave.ts";
import { searchDuckDuckGo } from "../src/providers/duckduckgo.ts";
import { searchMojeek } from "../src/providers/mojeek.ts";
import { searchStartpage } from "../src/providers/startpage.ts";
import { parseSearchQuery } from "../src/query.ts";
import type { SearchRequest } from "../src/types.ts";

const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

function request(query: string, fetchImpl: typeof fetch, limit = 5): SearchRequest {
  return { query, parsedQuery: parseSearchQuery(query), limit, fetch: fetchImpl, timeoutMs: 100 };
}

describe("providers", () => {
  it("Brave sends the key in a header, maps recency, and ignores Rich Search", async () => {
    let seenUrl = "";
    let seenHeaders = new Headers();
    const fetchImpl: typeof fetch = async (input, init) => {
      seenUrl = String(input);
      seenHeaders = new Headers(init?.headers);
      return new Response(fixture("brave-success.json"), { status: 200, headers: { "content-type": "application/json" } });
    };
    const req = request("中文查询", fetchImpl);
    req.recency = "week";
    const sources = await searchBrave(req, "top-secret");
    expect(sources.map(source => source.title)).toEqual(["Web"]);
    expect(seenHeaders.get("x-subscription-token")).toBe("top-secret");
    expect(seenUrl).toContain(encodeURIComponent("中文查询"));
    expect(seenUrl).toContain("freshness=pw");
    expect(seenUrl).not.toMatch(/search_lang|country=/);
  });

  it("Brave bounds result count and reports safe HTTP/malformed/body failures", async () => {
    const many = JSON.stringify({ web: { results: Array.from({ length: 8 }, (_, index) => ({
      title: `T${index}`, url: `https://example.com/${index}`,
    })) } });
    expect(await searchBrave(request("q", async () => new Response(many), 3), "key")).toHaveLength(3);
    await expect(searchBrave(request("q", async () => new Response("denied key", { status: 401 })), "key"))
      .rejects.toThrow("failed (401)");
    await expect(searchBrave(request("q", async () => new Response("not-json")), "key"))
      .rejects.toThrow("malformed JSON");
    await expect(searchBrave(request("q", async () => new Response("x".repeat(2 * 1024 * 1024 + 1))), "key"))
      .rejects.toThrow("exceeded");
  });

  it("DuckDuckGo has no forced locale, maps recency, and parses fixtures", async () => {
    let body = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response(fixture("duckduckgo-success.html"));
    };
    const req = request("测试", fetchImpl);
    req.recency = "day";
    const sources = await searchDuckDuckGo(req);
    expect(body).not.toContain("kl=us-en");
    expect(body).toContain("df=d");
    expect(sources[0]).toMatchObject({ title: "Title", url: "https://example.com/" });
  });

  it("DuckDuckGo detects challenge and HTTP failures", async () => {
    await expect(searchDuckDuckGo(request("q", async () => new Response('<div class="anomaly-modal"></div>'))))
      .rejects.toThrow("bot challenge");
    await expect(searchDuckDuckGo(request("q", async () => new Response("down", { status: 503 }))))
      .rejects.toThrow("failed (503)");
  });

  it("Startpage leaves locale unset and follows its form flow", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), body: String(init?.body ?? "") });
      if (seen.length === 1) return new Response('<form><input name="sc" value="token"></form>');
      return new Response(fixture("startpage-success.html"));
    };
    const sources = await searchStartpage(request("测试", fetchImpl));
    expect(seen[1].body).toContain("sc=token");
    expect(seen[1].body).not.toMatch(/language=|lang=/);
    expect(sources).toHaveLength(1);
  });

  it("Startpage detects challenge pages", async () => {
    await expect(searchStartpage(request("q", async () => new Response("captcha", { status: 429 }))))
      .rejects.toThrow("bot challenge");
  });

  it("Mojeek uses the global endpoint without language parameters", async () => {
    let seen = "";
    const fetchImpl: typeof fetch = async input => {
      seen = String(input);
      return new Response(fixture("mojeek-success.html"));
    };
    const sources = await searchMojeek(request("测试", fetchImpl));
    expect(seen).toContain("www.mojeek.com/search");
    expect(seen).not.toMatch(/[?&](lang|lb)=/);
    expect(sources).toHaveLength(1);
  });

  it("Mojeek detects challenge pages", async () => {
    await expect(searchMojeek(request("q", async () => new Response('<altcha-widget></altcha-widget>'))))
      .rejects.toThrow("bot challenge");
  });
});
