import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-test-"));
}

export function removeDir(dir: string): void {
  // Windows 上残留子进程/杀软可能瞬时持有目录句柄 → 短退避重试(与 renameWithRetry 同理)
  for (let attempt = 1; ; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") || attempt >= 5) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * attempt);
    }
  }
}

export async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}
