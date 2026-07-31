import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, readLock, releaseLock, LOCK_FILE } from "../src/store/lock.js";
import { makeTmpDir, removeDir } from "./helpers.js";

function writeLock(dir: string, pid: number): void {
  fs.writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify({ pid, startedAt: "t" }));
}

async function spawnAlivePid(): Promise<{ pid: number; kill: () => void }> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
  return { pid: child.pid!, kill: () => child.kill() };
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolve(child.pid!));
  });
  return pid;
}

describe("runner lock", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  it("acquires when no lock exists", () => {
    expect(acquireLock(dir)).toEqual({ ok: true });
    expect(readLock(dir)?.pid).toBe(process.pid);
  });

  it("refuses when a live foreign pid holds the lock", async () => {
    const alive = await spawnAlivePid();
    try {
      writeLock(dir, alive.pid);
      const result = acquireLock(dir);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.holder.pid).toBe(alive.pid);
      expect(readLock(dir)?.pid).toBe(alive.pid);
    } finally {
      alive.kill();
    }
  });

  it("takes over a dead pid's stale lock", async () => {
    writeLock(dir, await deadPid());
    expect(acquireLock(dir)).toEqual({ ok: true });
    expect(readLock(dir)?.pid).toBe(process.pid);
  });

  it("releaseLock removes own lock only", () => {
    acquireLock(dir);
    releaseLock(dir);
    expect(readLock(dir)).toBeNull();

    writeLock(dir, 999999);
    releaseLock(dir);
    expect(readLock(dir)?.pid).toBe(999999);
  });
});
