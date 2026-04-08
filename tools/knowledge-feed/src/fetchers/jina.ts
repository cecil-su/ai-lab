import type { SourceConfig, FeedItem, Fetcher } from "./types.js";

const JINA_BASE = "https://r.jina.ai/";

function extractTitle(markdown: string): string {
  // Try to find first H1
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled";
}

export const jinaFetcher: Fetcher = async (source: SourceConfig): Promise<FeedItem[]> => {
  const apiKey = process.env.JINA_API_KEY;

  const headers: Record<string, string> = {
    Accept: "text/markdown",
    "User-Agent": "knowledge-feed/0.1 (+https://github.com/ai-lab)",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(JINA_BASE + source.url, {
    signal: AbortSignal.timeout(30_000),
    headers,
  });

  if (!response.ok) {
    throw new Error(`Jina fetch failed: ${response.status} ${response.statusText}`);
  }

  const markdown = await response.text();

  if (!markdown.trim()) {
    return [];
  }

  return [{
    id: "",
    title: extractTitle(markdown),
    url: source.url,
    content: markdown.trim(),
    date: new Date().toISOString(),
  }];
};
