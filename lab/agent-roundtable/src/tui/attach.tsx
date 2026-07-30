import fs from "node:fs";
import path from "node:path";
import { render } from "ink";
import { writeJsonAtomic } from "../store/jsonl.js";
import { pidAlive } from "../store/lock.js";
import { App } from "./App.js";

const ATTACH_LOCK = "attach.lock";

interface AttachLock {
  pid: number;
  startedAt: string;
}

// 方案①(id 竞争拍板):限单 attach 写入。已有活 attach 持锁 → 本进程只读进入,
// 保证 inbox.jsonl 的写者始终唯一,不改动现有 inbox 存储与 cursor 语义。
function acquireAttachLock(dir: string): boolean {
  const file = path.join(dir, ATTACH_LOCK);
  if (fs.existsSync(file)) {
    try {
      const held = JSON.parse(fs.readFileSync(file, "utf8")) as AttachLock;
      if (held.pid !== process.pid && pidAlive(held.pid)) return false;
    } catch {
      // 锁文件损坏 → 视为残留,接管
    }
  }
  writeJsonAtomic(file, { pid: process.pid, startedAt: new Date().toISOString() } satisfies AttachLock);
  return true;
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
