import path from "node:path";
import { fileURLToPath } from "node:url";

// src/store/ 与 dist/store/ 距包根都是两级
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveTopicsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.ROUNDTABLE_HOME ?? path.join(PKG_ROOT, "topics");
}

export function topicDir(root: string, id: string): string {
  return path.join(root, id);
}
