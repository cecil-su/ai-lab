import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { FeedItem } from "./fetchers/types.js";

export interface SeenIndex {
  [sourceName: string]: string[];
}

const MAX_KEYS_PER_SOURCE = 500;

const UTM_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref", "fbclid", "gclid",
]);

export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hostname = url.hostname.toLowerCase();
    // Remove tracking params
    for (const key of [...url.searchParams.keys()]) {
      if (UTM_PARAMS.has(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    // Remove trailing slash
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
}

export function getDeduplicationKey(item: FeedItem): string {
  if (item.id) return `guid:${item.id}`;
  if (item.url) return `url:${normalizeUrl(item.url)}`;
  if (item.title) {
    const hash = createHash("sha256").update(item.title).digest("hex").slice(0, 8);
    return `title:${hash}`;
  }
  return "";
}

export async function loadSeen(path: string): Promise<SeenIndex> {
  try {
    const text = await readFile(path, "utf-8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function saveSeen(path: string, index: SeenIndex): Promise<void> {
  await writeFile(path, JSON.stringify(index, null, 2) + "\n", "utf-8");
}

export function deduplicateItems(
  items: FeedItem[],
  sourceName: string,
  seen: SeenIndex,
): FeedItem[] {
  const keys = seen[sourceName] ?? [];
  const keySet = new Set(keys);
  const newItems: FeedItem[] = [];

  for (const item of items) {
    const key = getDeduplicationKey(item);
    if (!key || keySet.has(key)) continue;
    keySet.add(key);
    keys.push(key);
    newItems.push(item);
  }

  // FIFO: keep only the last MAX_KEYS_PER_SOURCE keys
  if (keys.length > MAX_KEYS_PER_SOURCE) {
    seen[sourceName] = keys.slice(keys.length - MAX_KEYS_PER_SOURCE);
  } else {
    seen[sourceName] = keys;
  }

  return newItems;
}
