import fs from "node:fs";
import path from "node:path";
import { appendJsonl, readJsonl } from "./jsonl.js";

export const TRANSCRIPT_FILE = "transcript.jsonl";

export type EventKind =
  | "system"
  | "message"
  | "human"
  | "verdict"
  | "round_end"
  | "skip";

export interface TranscriptEvent {
  seq: number;
  ts: string;
  kind: EventKind;
  round: number;
  from?: string;
  body?: string;
  stance?: string;
}

export type NewTranscriptEvent = Omit<TranscriptEvent, "seq" | "ts"> & { ts?: string };

export function readTranscript(dir: string): TranscriptEvent[] {
  const events = readJsonl<TranscriptEvent>(path.join(dir, TRANSCRIPT_FILE));
  let prev = 0;
  for (const event of events) {
    if (event.seq <= prev) {
      throw new Error(`transcript corrupted: seq ${event.seq} after ${prev}`);
    }
    prev = event.seq;
  }
  return events;
}

export function lastSeq(dir: string): number {
  const events = readTranscript(dir);
  return events.at(-1)?.seq ?? 0;
}

// 单写者原则:只有 runner 进程可以调用 appendEvent
export function appendEvent(dir: string, event: NewTranscriptEvent): TranscriptEvent {
  const full: TranscriptEvent = {
    ...event,
    seq: lastSeq(dir) + 1,
    ts: event.ts ?? new Date().toISOString(),
  };
  appendJsonl(path.join(dir, TRANSCRIPT_FILE), full);
  return full;
}

export interface WatchOptions {
  pollMs?: number;
  fromStart?: boolean;
}

// tail 订阅:轮询为主,fs.watch 尽力加速(Windows 上 fs.watch 不可靠)
export function watchTranscript(
  dir: string,
  onEvents: (events: TranscriptEvent[]) => void,
  opts: WatchOptions = {},
): () => void {
  const file = path.join(dir, TRANSCRIPT_FILE);
  let offset = 0;
  if (!opts.fromStart && fs.existsSync(file)) offset = fs.statSync(file).size;
  let remainder = Buffer.alloc(0);

  const check = (): void => {
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size <= offset) return;
    const fd = fs.openSync(file, "r");
    try {
      const chunk = Buffer.alloc(size - offset);
      fs.readSync(fd, chunk, 0, chunk.length, offset);
      offset = size;
      let data = Buffer.concat([remainder, chunk]);
      const events: TranscriptEvent[] = [];
      let nl: number;
      while ((nl = data.indexOf(0x0a)) !== -1) {
        const line = data.subarray(0, nl).toString("utf8").trim();
        data = data.subarray(nl + 1);
        if (line !== "") events.push(JSON.parse(line) as TranscriptEvent);
      }
      remainder = data;
      if (events.length > 0) onEvents(events);
    } finally {
      fs.closeSync(fd);
    }
  };

  const timer = setInterval(check, opts.pollMs ?? 500);
  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(dir, () => check());
  } catch {
    // 轮询兜底
  }
  return () => {
    clearInterval(timer);
    watcher?.close();
  };
}
