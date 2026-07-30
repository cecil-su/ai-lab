import fs from "node:fs";
import path from "node:path";
import { appendJsonl, readJsonl, writeJsonAtomic } from "./jsonl.js";

export const INBOX_FILE = "inbox.jsonl";
const CURSOR_FILE = "inbox.cursor";

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

export function readInbox(dir: string): InboxEntry[] {
  return readJsonl<InboxEntry>(path.join(dir, INBOX_FILE));
}

// attach 进程写 inbox;runner 只读 + 推进 cursor(消费标记与 inbox.jsonl 分离,保持追加文件单写者)
export function appendInbox(dir: string, entry: NewInboxEntry): InboxEntry {
  const id = (readInbox(dir).at(-1)?.id ?? 0) + 1;
  const full: InboxEntry = {
    id,
    ts: entry.ts ?? new Date().toISOString(),
    kind: entry.kind,
    from: entry.from,
    ...(entry.body !== undefined ? { body: entry.body } : {}),
  };
  appendJsonl(path.join(dir, INBOX_FILE), full);
  return full;
}

export function consumedUpTo(dir: string): number {
  const file = path.join(dir, CURSOR_FILE);
  if (!fs.existsSync(file)) return 0;
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { consumed: number }).consumed;
}

export function readPending(dir: string): InboxEntry[] {
  const cursor = consumedUpTo(dir);
  return readInbox(dir).filter((entry) => entry.id > cursor);
}

export function markConsumed(dir: string, uptoId: number): void {
  const consumed = Math.max(uptoId, consumedUpTo(dir));
  writeJsonAtomic(path.join(dir, CURSOR_FILE), { consumed });
}
