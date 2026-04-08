#!/usr/bin/env node

import { parseArgs } from "node:util";
import { join, resolve } from "node:path";
import { loadConfig } from "./config.js";
import { loadSeen, saveSeen, deduplicateItems } from "./dedup.js";
import { generateMarkdown } from "./generator.js";
import { rssFetcher } from "./fetchers/rss.js";
import { jinaFetcher } from "./fetchers/jina.js";
import type { Fetcher, SourceConfig } from "./fetchers/types.js";

const fetchers: Record<SourceConfig["type"], Fetcher> = {
  rss: rssFetcher,
  jina: jinaFetcher,
};

const { values } = parseArgs({
  options: {
    source: { type: "string", short: "s" },
    config: { type: "string", short: "c", default: "docs/knowledge/_sources.yaml" },
    output: { type: "string", short: "o", default: "docs/knowledge" },
  },
  strict: false,
});

const configPath = resolve(values.config as string);
const outputDir = resolve(values.output as string);
const sourceFilter = values.source as string | undefined;

async function main(): Promise<void> {
  let sources = await loadConfig(configPath);

  if (sourceFilter) {
    sources = sources.filter((s) => s.name === sourceFilter);
    if (sources.length === 0) {
      console.error(`Source "${sourceFilter}" not found or disabled`);
      process.exit(1);
    }
  }

  const seenPath = join(outputDir, "_seen.json");
  const seen = await loadSeen(seenPath);

  let totalNew = 0;
  let totalFailed = 0;

  for (const source of sources) {
    try {
      const fetcher = fetchers[source.type];
      console.log(`  [${source.name}] Fetching (${source.type})...`);
      const items = await fetcher(source);
      const newItems = deduplicateItems(items, source.name, seen);

      if (newItems.length === 0) {
        console.log(`  [${source.name}] No new items`);
        continue;
      }

      const filePath = await generateMarkdown(source, newItems, outputDir);
      console.log(`  [${source.name}] +${newItems.length} items → ${filePath}`);
      totalNew += newItems.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${source.name}] FAILED: ${msg}`);
      totalFailed++;
    }
  }

  await saveSeen(seenPath, seen);

  console.log(`\nDone: ${sources.length} sources, +${totalNew} new items, ${totalFailed} failed`);

  if (totalFailed > 0 && totalNew === 0 && sources.length === totalFailed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
