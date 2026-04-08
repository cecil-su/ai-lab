import { describe, it, expect } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../config.js";

const TMP = join(tmpdir(), "knowledge-feed-test-config");

async function writeYaml(filename: string, content: string): Promise<string> {
  await mkdir(TMP, { recursive: true });
  const path = join(TMP, filename);
  await writeFile(path, content, "utf-8");
  return path;
}

describe("loadConfig", () => {
  it("parses valid config with defaults", async () => {
    const path = await writeYaml("valid.yaml", `
sources:
  - name: "test-feed"
    url: "https://example.com/feed.xml"
    type: "rss"
    tags: ["test"]
`);
    const sources = await loadConfig(path);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toEqual({
      name: "test-feed",
      url: "https://example.com/feed.xml",
      type: "rss",
      tags: ["test"],
      enabled: true,
      max_items: 20,
    });
  });

  it("respects custom max_items", async () => {
    const path = await writeYaml("max-items.yaml", `
sources:
  - name: "test"
    url: "https://example.com/feed"
    type: "jina"
    tags: []
    max_items: 5
`);
    const sources = await loadConfig(path);
    expect(sources[0].max_items).toBe(5);
  });

  it("filters out disabled sources", async () => {
    const path = await writeYaml("disabled.yaml", `
sources:
  - name: "active"
    url: "https://example.com/a"
    type: "rss"
    tags: []
  - name: "disabled"
    url: "https://example.com/b"
    type: "rss"
    tags: []
    enabled: false
`);
    const sources = await loadConfig(path);
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe("active");
  });

  it("throws on missing name", async () => {
    const path = await writeYaml("no-name.yaml", `
sources:
  - url: "https://example.com"
    type: "rss"
    tags: []
`);
    await expect(loadConfig(path)).rejects.toThrow('"name" is required');
  });

  it("throws on invalid type", async () => {
    const path = await writeYaml("bad-type.yaml", `
sources:
  - name: "test"
    url: "https://example.com"
    type: "invalid"
    tags: []
`);
    await expect(loadConfig(path)).rejects.toThrow('"type" must be one of');
  });

  it("throws on missing tags", async () => {
    const path = await writeYaml("no-tags.yaml", `
sources:
  - name: "test"
    url: "https://example.com"
    type: "rss"
`);
    await expect(loadConfig(path)).rejects.toThrow('"tags" is required');
  });
});
