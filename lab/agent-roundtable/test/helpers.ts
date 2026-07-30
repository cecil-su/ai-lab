import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-test-"));
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}
