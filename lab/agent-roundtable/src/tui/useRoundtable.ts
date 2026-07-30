import { useCallback, useEffect, useState } from "react";
import { readPending, type InboxEntry } from "../store/inbox.js";
import { pidAlive, readLock } from "../store/lock.js";
import { loadTopic, type Topic } from "../store/topic.js";
import { readTranscript, type TranscriptEvent } from "../store/transcript.js";

// 数据源:全量读 transcript + inbox pending + topic + lock,轮询合并(Windows fs.watch 不可靠,以轮询为主)。
// attach 只读这些文件(单写者原则不受影响);readPending 复用 runner 的 cursor,消费后 pending 自然转正。

export interface RoundtableState {
  events: TranscriptEvent[];
  pending: InboxEntry[];
  topic: Topic;
  lockAlive: boolean;
}

function readState(dir: string, prev?: RoundtableState): RoundtableState {
  let events = prev?.events ?? [];
  try {
    events = readTranscript(dir);
  } catch {
    // 并发写入的半行/瞬时不一致:沿用上次快照,下个轮询周期自愈
  }
  const pending = readPending(dir).filter((e) => e.kind === "say");
  const topic = loadTopic(dir);
  const lock = readLock(dir);
  return { events, pending, topic, lockAlive: lock ? pidAlive(lock.pid) : false };
}

export function useRoundtable(dir: string, pollMs = 500): RoundtableState & { refresh: () => void } {
  const [state, setState] = useState<RoundtableState>(() => readState(dir));
  const refresh = useCallback(() => setState((prev) => readState(dir, prev)), [dir]);
  useEffect(() => {
    const timer = setInterval(refresh, pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);
  return { ...state, refresh };
}
