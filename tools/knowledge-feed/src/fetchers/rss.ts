import {
  parseRssFeed,
  parseAtomFeed,
  parseJsonFeed,
  detectRssFeed,
  detectAtomFeed,
  detectJsonFeed,
} from "feedsmith";
import type { SourceConfig, FeedItem, Fetcher } from "./types.js";

interface FeedEntry {
  title?: string;
  link?: string;
  id?: string;
  guid?: { value?: string } | string;
  description?: string;
  content?: string;
  summary?: string;
  pubDate?: string;
  published?: string;
  updated?: string;
}

interface ParsedFeed {
  title?: string;
  items?: FeedEntry[];
}

function extractId(entry: FeedEntry): string {
  if (entry.id) return entry.id;
  if (entry.guid) {
    if (typeof entry.guid === "string") return entry.guid;
    if (typeof entry.guid === "object" && entry.guid.value) return entry.guid.value;
  }
  return "";
}

function htmlToMarkdown(html: string): string {
  return html
    // Convert links: <a href="url">text</a> → [text](url)
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    // Convert bold
    .replace(/<\/?(?:b|strong)>/gi, "**")
    // Convert italic
    .replace(/<\/?(?:i|em)>/gi, "*")
    // Convert <br> to newline
    .replace(/<br\s*\/?>/gi, "\n")
    // Convert <p> to double newline
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    // Strip remaining HTML tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Clean up extra whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractContent(entry: FeedEntry): string {
  const raw = entry.content || entry.summary || entry.description || "";
  // If content contains HTML tags, convert to markdown
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return htmlToMarkdown(raw);
  }
  return raw;
}

function extractDate(entry: FeedEntry): string | null {
  const raw = entry.pubDate || entry.published || entry.updated;
  if (!raw) return null;
  try {
    return new Date(raw).toISOString();
  } catch {
    return raw;
  }
}

function resolveUrl(href: string | undefined, base: string): string {
  if (!href) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function parseFeedText(text: string): ParsedFeed {
  if (detectRssFeed(text)) return parseRssFeed(text) as ParsedFeed;
  if (detectAtomFeed(text)) return parseAtomFeed(text) as ParsedFeed;
  if (detectJsonFeed(text)) return parseJsonFeed(text) as ParsedFeed;
  throw new Error("Unrecognized feed format");
}

export const rssFetcher: Fetcher = async (source: SourceConfig): Promise<FeedItem[]> => {
  const response = await fetch(source.url, {
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "knowledge-feed/0.1 (+https://github.com/ai-lab)" },
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const feed = parseFeedText(text);
  const entries = feed.items ?? [];

  return entries.slice(0, source.max_items).map((entry): FeedItem => ({
    id: extractId(entry),
    title: entry.title || "Untitled",
    url: resolveUrl(entry.link, source.url),
    content: extractContent(entry),
    date: extractDate(entry),
  }));
};
