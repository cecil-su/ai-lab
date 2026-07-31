import fs from "node:fs";
import path from "node:path";
import { renameWithRetry } from "./jsonl.js";

export const INBOX_FILE = "inbox.jsonl";
const CURSOR_FILE = "inbox.cursor";
const LOCK_FILE = "inbox.lock";
const LOCK_TIMEOUT_MS = 2000;
const LOCK_STALE_MS = 10_000;

export type InboxKind = "say" | "stop";

export interface InboxEntry {
  id: number;
  ts: string;
  kind: InboxKind;
  from: string;
  body?: string;
}

export interface NewInboxEntry {
  kind: InboxKind;
  from: string;
  body?: string;
  ts?: string;
}

/** 容错读结果:entries 带物理行号 line;badLines 为解析失败的物理行号;totalLines 为已见物理行数(A2) */
export interface InboxRead {
  entries: (InboxEntry & { line: number })[];
  totalLines: number;
  badLines: number[];
}

// A2:并发写者(attach / cmdStop / continue --ask)共用短临界区,避免 appendFileSync 字节交错半行。
// 短命锁 + 毫秒自旋 + 陈旧(mtime)清理;超时后 best-effort 直接执行,不引入 pid 接管协议。
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withInboxLock<T>(dir: string, fn: () => T): T {
  const lockPath = path.join(dir, LOCK_FILE);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") break; // 异常:放弃锁,best-effort
      // 陈旧锁(写者崩溃遗留)按 mtime 清理,不看 pid
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        // 锁刚被别人释放,重试
      }
      if (Date.now() > deadline) break; // 超时:best-effort
      sleepMs(5);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
      fs.rmSync(lockPath, { force: true });
    }
  }
}

/** 容错逐行读:跳过坏行但计入物理行数(保持行号水位线对齐);末尾半行丢弃 */
export function readInboxRaw(dir: string): InboxRead {
  const file = path.join(dir, INBOX_FILE);
  if (!fs.existsSync(file)) return { entries: [], totalLines: 0, badLines: [] };
  const segments = fs.readFileSync(file, "utf8").split("\n");
  segments.pop(); // 丢弃末段:正常为 ""(以 \n 收尾),异常为他进程写入中的半行
  const entries: (InboxEntry & { line: number })[] = [];
  const badLines: number[] = [];
  let line = 0;
  for (const seg of segments) {
    if (seg.trim() === "") continue; // 空段不计物理行(appendInbox 不产空行)
    line += 1;
    try {
      entries.push({ ...(JSON.parse(seg) as InboxEntry), line });
    } catch {
      badLines.push(line); // 坏行(字节交错)跳过但已计入 line
    }
  }
  return { entries, totalLines: line, badLines };
}

export function readInbox(dir: string): InboxEntry[] {
  return readInboxRaw(dir).entries.map(({ line: _line, ...e }) => e);
}

// attach/CLI 写 inbox;runner 只读 + 推进 cursor(物理行号水位线,A2)
export function appendInbox(dir: string, entry: NewInboxEntry): InboxEntry {
  return withInboxLock(dir, () => {
    const id = (readInboxRaw(dir).entries.at(-1)?.id ?? 0) + 1; // id 仅作展示/调试标签
    const full: InboxEntry = {
      id,
      ts: entry.ts ?? new Date().toISOString(),
      kind: entry.kind,
      from: entry.from,
      ...(entry.body !== undefined ? { body: entry.body } : {}),
    };
    fs.appendFileSync(path.join(dir, INBOX_FILE), JSON.stringify(full) + "\n");
    return full;
  });
}

/** 已消费的物理行数;兼容旧 { consumed:<id> } 游标(迁移为 id<=consumed 的条目数,A2) */
export function consumedUpTo(dir: string): number {
  const file = path.join(dir, CURSOR_FILE);
  if (!fs.existsSync(file)) return 0;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { lines?: number; consumed?: number };
  if (typeof raw.lines === "number") return raw.lines;
  if (typeof raw.consumed === "number") {
    // 旧 id 水位线 → 行数(旧 id 自 1 顺序、每条一行,取 id<=consumed 的条目数)
    return readInboxRaw(dir).entries.filter((e) => e.id <= raw.consumed!).length;
  }
  return 0;
}

/** 未消费条目:物理行号 > cursor */
export function readPending(dir: string): InboxEntry[] {
  const cursor = consumedUpTo(dir);
  return readInboxRaw(dir)
    .entries.filter((e) => e.line > cursor)
    .map(({ line: _line, ...e }) => e);
}

export function markConsumed(dir: string, throughLines: number): void {
  const lines = Math.max(throughLines, consumedUpTo(dir));
  // 唯一 tmp 名 + EPERM 重试,避免 Windows 瞬态句柄导致 cursor 更新失败
  const tmp = path.join(dir, `${CURSOR_FILE}.tmp-${process.pid}-${Date.now().toString(36)}`);
  fs.writeFileSync(tmp, JSON.stringify({ lines }) + "\n");
  try {
    renameWithRetry(tmp, path.join(dir, CURSOR_FILE));
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
