import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceConfig, FeedItem } from "./fetchers/types.js";

function formatDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildFrontmatter(source: SourceConfig, date: string, itemCount: number): string {
  const tags = source.tags.map((t) => JSON.stringify(t)).join(", ");
  return [
    "---",
    `source: ${source.name}`,
    `fetched: "${date}"`,
    `tags: [${tags}]`,
    `items: ${itemCount}`,
    "---",
  ].join("\n");
}

function buildItemBlock(item: FeedItem): string {
  const lines: string[] = [];
  lines.push(`## ${item.title || "Untitled"}`);
  lines.push("");
  if (item.url) {
    lines.push(`> ${item.url}`);
    lines.push("");
  }
  if (item.content) {
    lines.push(item.content.trim());
  }
  return lines.join("\n");
}

export async function generateMarkdown(
  source: SourceConfig,
  items: FeedItem[],
  outputDir: string,
): Promise<string | null> {
  if (items.length === 0) return null;

  const date = formatDate();
  const dir = join(outputDir, source.name);
  await mkdir(dir, { recursive: true });

  const filePath = join(dir, `${date}.md`);

  // Check if file already exists (same-day append)
  let existing = "";
  try {
    existing = await readFile(filePath, "utf-8");
  } catch {
    // ENOENT expected for new files
  }

  if (existing) {
    // Append new items to existing file
    // Update item count in frontmatter
    const itemCountMatch = existing.match(/^items: (\d+)$/m);
    const oldCount = itemCountMatch ? parseInt(itemCountMatch[1], 10) : 0;
    const newCount = oldCount + items.length;
    const updated = existing.replace(/^items: \d+$/m, `items: ${newCount}`);

    const newBlocks = items.map(buildItemBlock).join("\n\n---\n\n");
    const content = updated.trimEnd() + "\n\n---\n\n" + newBlocks + "\n";
    await writeFile(filePath, content, "utf-8");
  } else {
    // Create new file
    const frontmatter = buildFrontmatter(source, date, items.length);
    const title = `# ${source.name} | ${date}`;
    const blocks = items.map(buildItemBlock).join("\n\n---\n\n");
    const content = frontmatter + "\n\n" + title + "\n\n" + blocks + "\n";
    await writeFile(filePath, content, "utf-8");
  }

  return filePath;
}
