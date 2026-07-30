import fs from "node:fs";
import path from "node:path";
import { render } from "ink";
import { pidAlive } from "../store/lock.js";
import { App } from "./App.js";

const ATTACH_LOCK = "attach.lock";

interface AttachLock {
  pid: number;
  startedAt: string;
}

// 方案①(id 竞争拍板):限单 attach 写入。已有活 attach 持锁 → 本进程只读进入,
// 保证 inbox.jsonl 的写者始终唯一,不改动现有 inbox 存储与 cursor 语义。
// 原子占坑(openSync wx / O_EXCL),消除 exists-then-write 的 TOCTOU:并发 attach 至多一个可写。
function acquireAttachLock(dir: string): boolean {
  const file = path.join(dir, ATTACH_LOCK);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, "wx");
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() } satisfies AttachLock));
      } finally {
        fs.closeSync(fd);
      }
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let held: AttachLock | null = null;
      try {
        held = JSON.parse(fs.readFileSync(file, "utf8")) as AttachLock;
      } catch {
        // 锁文件损坏 → 视为残留
      }
      if (held && held.pid !== process.pid && pidAlive(held.pid)) return false;
      if (held && held.pid === process.pid) return true; // 本进程已持有,幂等
      fs.rmSync(file, { force: true }); // 死 pid / 坏锁 → 清理后重试
    }
  }
  return false; // 残留已清但被并发者抢先 → 只读进入
}

function releaseAttachLock(dir: string): void {
  const file = path.join(dir, ATTACH_LOCK);
  try {
    const held = JSON.parse(fs.readFileSync(file, "utf8")) as AttachLock;
    if (held.pid === process.pid) fs.rmSync(file, { force: true });
  } catch {
    // 已被清理
  }
}

export interface AttachOptions {
  humanName: string;
}

export async function runAttach(dir: string, opts: AttachOptions): Promise<void> {
  const canWrite = acquireAttachLock(dir);
  const app = render(<App dir={dir} humanName={opts.humanName} canWrite={canWrite} />);
  try {
    await app.waitUntilExit();
  } finally {
    if (canWrite) releaseAttachLock(dir);
  }
}
