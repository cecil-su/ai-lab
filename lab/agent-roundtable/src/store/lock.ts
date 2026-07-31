import fs from "node:fs";
import path from "node:path";

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

// 空占坑文件(占坑者刚 openSync、尚未写入 pid)超过此龄视为崩溃残留可清;
// 正常写入是同步瞬时,只有占坑后立刻崩溃才会长期留空。
const EMPTY_LOCK_STALE_MS = 5000;
const UNKNOWN_HOLDER: RunnerLock = { pid: -1, startedAt: "" };

function readRaw(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null; // 文件刚被释放
  }
}

function olderThan(file: string, ms: number): boolean {
  try {
    return Date.now() - fs.statSync(file).mtimeMs > ms;
  } catch {
    return true; // 文件已消失 → 当作可清理
  }
}

// 原子占坑:openSync(...,"wx") 以 O_EXCL 建锁,已存在即 EEXIST → 检查 holder。
// 存活他人 pid → 拒绝;死 pid / 坏锁 → 崩溃残留,删后重试抢占。
// 关键:openSync 建的是空文件,writeSync 写 pid 之间有跨进程窗口 —— 并发进程读到空文件
// 时必须"让步(占坑者建档中)"而非删除,否则会误删刚抢到的锁造成双持。
export function acquireLock(dir: string): AcquireResult {
  const file = path.join(dir, LOCK_FILE);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, "wx");
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() } satisfies RunnerLock));
      } finally {
        fs.closeSync(fd);
      }
      return { ok: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const raw = readRaw(file);
      if (raw === null) continue; // 刚被释放 → 重试 wx
      if (raw.trim() === "") {
        // 空占坑:占坑者正在写 pid → 让步;仅长期留空(占坑后崩溃)才清理重试
        if (olderThan(file, EMPTY_LOCK_STALE_MS)) {
          fs.rmSync(file, { force: true });
          continue;
        }
        return { ok: false, holder: UNKNOWN_HOLDER };
      }
      let holder: RunnerLock | null = null;
      try {
        holder = JSON.parse(raw) as RunnerLock;
      } catch {
        // 非空但坏 JSON(字节交错等)→ 崩溃残留
      }
      if (holder && holder.pid !== process.pid && pidAlive(holder.pid)) return { ok: false, holder };
      if (holder && holder.pid === process.pid) return { ok: true }; // 本进程已持有,幂等
      fs.rmSync(file, { force: true }); // 死 pid / 坏锁 → 清理后重试
    }
  }
  // 多轮仍被并发者抢先 → 保证至多一持有者,本进程让步
  const raw = readRaw(file);
  if (raw) {
    try {
      return { ok: false, holder: JSON.parse(raw) as RunnerLock };
    } catch {
      /* 坏内容,下方回退 */
    }
  }
  return { ok: false, holder: UNKNOWN_HOLDER };
}

export function releaseLock(dir: string): void {
  const existing = readLock(dir);
  if (existing && existing.pid === process.pid) {
    fs.rmSync(path.join(dir, LOCK_FILE), { force: true });
  }
}
