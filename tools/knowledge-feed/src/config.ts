import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { SourceConfig } from "./fetchers/types.js";

interface RawSource {
  name?: unknown;
  url?: unknown;
  type?: unknown;
  tags?: unknown;
  enabled?: unknown;
  max_items?: unknown;
}

const VALID_TYPES = new Set(["rss", "jina"]);

function validateSource(raw: RawSource, index: number): SourceConfig {
  if (typeof raw.name !== "string" || raw.name.length === 0) {
    throw new Error(`sources[${index}]: "name" is required and must be a non-empty string`);
  }
  if (typeof raw.url !== "string" || raw.url.length === 0) {
    throw new Error(`sources[${index}]: "url" is required and must be a non-empty string`);
  }
  if (typeof raw.type !== "string" || !VALID_TYPES.has(raw.type)) {
    throw new Error(`sources[${index}]: "type" must be one of: ${[...VALID_TYPES].join(", ")}`);
  }
  if (!Array.isArray(raw.tags)) {
    throw new Error(`sources[${index}]: "tags" is required and must be an array`);
  }

  return {
    name: raw.name,
    url: raw.url,
    type: raw.type as SourceConfig["type"],
    tags: raw.tags.map(String),
    enabled: raw.enabled !== false,
    max_items: typeof raw.max_items === "number" ? raw.max_items : 20,
  };
}

export async function loadConfig(yamlPath: string): Promise<SourceConfig[]> {
  const text = await readFile(yamlPath, "utf-8");
  const data = parse(text);

  if (!data || !Array.isArray(data.sources)) {
    throw new Error(`Invalid config: expected "sources" array in ${yamlPath}`);
  }

  return data.sources
    .map((raw: RawSource, i: number) => validateSource(raw, i))
    .filter((s: SourceConfig) => s.enabled);
}
