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

// 空占坑文件(占坑者刚 openSync、尚未写入 pid)超过此龄视为崩溃残留可清;
// 与 store/lock.ts 的 EMPTY_LOCK_STALE_MS 同构——不能删刚抢到的锁,否则双 attach 持写锁。
const EMPTY_LOCK_STALE_MS = 5000;

// 方案①(id 竞争拍板):限单 attach 写入。已有活 attach 持锁 → 本进程只读进入,
// 保证 inbox.jsonl 的写者始终唯一,不改动现有 inbox 存储与 cursor 语义。
// 原子占坑(openSync wx / O_EXCL),消除 exists-then-write 的 TOCTOU:并发 attach 至多一个可写。
// ⚠ 勿复制 store/lock.ts 后丢修复:空占坑让步窗口与坏锁清理必须与 runner 锁同构(红队实测点)。
function acquireAttachLock(dir: string): boolean {
  const file = path.join(dir, ATTACH_LOCK);
  for (let attempt = 0; attempt < 3; attempt++) {
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
      let raw: string | null = null;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch {
        continue; // 文件刚被释放 → 重试 wx
      }
      if (raw.trim() === "") {
        // 空占坑:占坑者正在写 pid → 让步;仅长期留空(占坑后崩溃)才清理重试
        if (Date.now() - fs.statSync(file).mtimeMs > EMPTY_LOCK_STALE_MS) {
          fs.rmSync(file, { force: true });
          continue;
        }
        return false;
      }
      let held: AttachLock | null = null;
      try {
        held = JSON.parse(raw) as AttachLock;
      } catch {
        // 非空但坏 JSON(字节交错等)→ 视为残留,下方清理重试
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
  // 非 TTY(管道/重定向/日志采集)根本无法输入,不得抢占写锁把真实用户挡在只读外。
  // isTTY 为 true 才可能支持 raw mode;具体 raw 模式由 App 层启用时再校验。
  const canWrite = process.stdin.isTTY === true && acquireAttachLock(dir);
  const app = render(<App dir={dir} humanName={opts.humanName} canWrite={canWrite} />);
  try {
    await app.waitUntilExit();
  } finally {
    if (canWrite) releaseAttachLock(dir);
  }
}
