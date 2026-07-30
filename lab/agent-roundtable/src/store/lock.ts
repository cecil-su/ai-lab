import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./jsonl.js";

export const LOCK_FILE = "runner.lock";

export interface RunnerLock {
  pid: number;
  startedAt: string;
}

export function readLock(dir: string): RunnerLock | null {
  const file = path.join(dir, LOCK_FILE);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as RunnerLock;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type AcquireResult = { ok: true } | { ok: false; holder: RunnerLock };

// 存活的他人 pid → 拒绝;死 pid → 视为崩溃残留,接管
export function acquireLock(dir: string): AcquireResult {
  const existing = readLock(dir);
  if (existing && existing.pid !== process.pid && pidAlive(existing.pid)) {
    return { ok: false, holder: existing };
  }
  writeJsonAtomic(path.join(dir, LOCK_FILE), {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  } satisfies RunnerLock);
  return { ok: true };
}

export function releaseLock(dir: string): void {
  const existing = readLock(dir);
  if (existing && existing.pid === process.pid) {
    fs.rmSync(path.join(dir, LOCK_FILE), { force: true });
  }
}
