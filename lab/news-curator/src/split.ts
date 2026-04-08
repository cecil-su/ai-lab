import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const CHAR_THRESHOLD = 15000;

const { positionals } = parseArgs({ allowPositionals: true });

const filePath = positionals[0];
if (!filePath) {
  console.error("Usage: news-curator split <file.md>");
  process.exit(1);
}

interface Parsed {
  frontmatter: string;
  body: string;
}

function parseFrontmatter(content: string): Parsed {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (match) {
    return { frontmatter: match[0], body: content.slice(match[0].length) };
  }
  return { frontmatter: "", body: content };
}

function splitByH2(body: string): string[] {
  const sections: string[] = [];
  const lines = body.split("\n");
  let current: string[] = [];

  for (const line of lines) {
    if (/^## /.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) {
    sections.push(current.join("\n"));
  }
  return sections;
}

function splitByParagraph(text: string): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current: string[] = [];
  let currentLen = 0;

  for (const para of paragraphs) {
    if (currentLen + para.length > CHAR_THRESHOLD && current.length > 0) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentLen = 0;
    }
    current.push(para);
    currentLen += para.length;
  }
  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }
  return chunks;
}

async function main() {
  const raw = await readFile(filePath, "utf-8");

  if (raw.length < CHAR_THRESHOLD) {
    console.log(`File is ${raw.length} chars — no split needed (threshold: ${CHAR_THRESHOLD}).`);
    return;
  }

  const { frontmatter, body } = parseFrontmatter(raw);
  const h2Sections = splitByH2(body);

  // Expand sections that are still too long
  const parts: string[] = [];
  for (const section of h2Sections) {
    if (section.length > CHAR_THRESHOLD) {
      parts.push(...splitByParagraph(section));
    } else {
      parts.push(section);
    }
  }

  const dir = dirname(filePath);
  const name = basename(filePath, ".md");

  for (let i = 0; i < parts.length; i++) {
    const partFile = join(dir, `${name}-part${i + 1}.md`);
    const content = `${frontmatter}\n${parts[i].trim()}\n`;
    await writeFile(partFile, content, "utf-8");
  }

  console.log(`Split into ${parts.length} parts: ${name}-part1.md ... ${name}-part${parts.length}.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
