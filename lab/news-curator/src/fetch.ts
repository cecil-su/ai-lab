import { parseArgs } from "node:util";
import { writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: "string", short: "o", default: "." },
  },
});

const url = positionals[0];
if (!url) {
  console.error("Usage: news-curator fetch <url> [--output <dir>]");
  process.exit(1);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function slugFromUrl(rawUrl: string): string {
  const pathname = new URL(rawUrl).pathname.replace(/\/$/, "");
  const last = pathname.split("/").filter(Boolean).pop() ?? "untitled";
  return slugify(last);
}

async function resolveFilename(dir: string, base: string, ext: string): Promise<string> {
  let name = `${base}${ext}`;
  let i = 1;
  while (true) {
    try {
      await access(join(dir, name));
      name = `${base}-${i}${ext}`;
      i++;
    } catch {
      return name;
    }
  }
}

async function main() {
  const outputDir = values.output!;

  console.log(`Fetching: ${url}`);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const html = await page.content();
    const pageTitle = await page.title();

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      console.error("Readability failed to extract article content.");
      process.exit(1);
    }

    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    const markdown = turndown.turndown(article.content);

    const title = article.title || pageTitle || "Untitled";
    const slug = slugify(title) || slugFromUrl(url);
    const date = new Date().toISOString().slice(0, 10);

    const frontmatter = [
      "---",
      `url: ${url}`,
      `title: "${title.replace(/"/g, '\\"')}"`,
      `date: ${date}`,
      "---",
    ].join("\n");

    const content = `${frontmatter}\n\n${markdown}\n`;

    const filename = await resolveFilename(outputDir, slug, ".md");
    const filepath = join(outputDir, filename);
    await writeFile(filepath, content, "utf-8");

    console.log(`Saved: ${filepath} (${title})`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
