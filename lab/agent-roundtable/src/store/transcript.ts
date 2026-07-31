import fs from "node:fs";
import path from "node:path";
import type { SessionRef } from "../adapters/types.js";
import { appendJsonl, readJsonl } from "./jsonl.js";

export const TRANSCRIPT_FILE = "transcript.jsonl";

export type EventKind =
  | "system"
  | "message"
  | "human"
  | "verdict"
  | "round_end"
  | "skip"
  | "error";

/**
 * Phase-3 ① 提交元数据:该次发言(或失败)后参与者的会话/累计 token 状态。
 * 累计值(非增量),重建时最后一条胜出;message/skip/error(from=参与者)携带,
 * 使 transcript 可重建 topic.json 的 participant 派生字段。
 */
export interface SpeechCommit {
  sessionRef: SessionRef | null;
  tokens: { input: number; cached: number; output: number };
}

export interface TranscriptEvent {
  seq: number;
  ts: string;
  kind: EventKind;
  round: number;
  from?: string;
  body?: string;
  stance?: string;
  commit?: SpeechCommit;
}

export type NewTranscriptEvent = Omit<TranscriptEvent, "seq" | "ts"> & { ts?: string };

export interface TranscriptRead {
  events: TranscriptEvent[];
  /** 损坏行(崩溃残留/字节交错)行号:容错跳过,证据索引据此降级可信度 */
  badLines: number[];
}

export function readTranscriptDetailed(dir: string): TranscriptRead {
  const { entries, badLines } = readJsonl<TranscriptEvent>(path.join(dir, TRANSCRIPT_FILE));
  if (badLines.length > 0) {
    // 崩溃残留/字节交错:跳过坏行继续,不让恢复在恢复现场二次崩溃(红队实测点)
    console.error(`[transcript] ${badLines.length} 行损坏已跳过(行号 ${badLines.join(",")}),可能丢失一条事件`);
  }
  let prev = 0;
  for (const event of entries) {
    if (event.seq <= prev) {
      throw new Error(`transcript corrupted: seq ${event.seq} after ${prev}`);
    }
    prev = event.seq;
  }
  return { events: entries, badLines };
}

export function readTranscript(dir: string): TranscriptEvent[] {
  return readTranscriptDetailed(dir).events;
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
        if (line === "") continue;
        try {
          events.push(JSON.parse(line) as TranscriptEvent);
        } catch {
          // 坏行(崩溃残留合并)跳过,不炸掉 TUI 跟随
        }
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
