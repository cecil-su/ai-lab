import fs from "node:fs";
import path from "node:path";
import { resolveAdapter } from "../adapters/registry.js";
import type { ProviderAdapter, SpeakResult } from "../adapters/types.js";
import { readPending, markConsumed } from "../store/inbox.js";
import { acquireLock, releaseLock } from "../store/lock.js";
import { loadTopic, saveTopic, transition, type Participant, type Topic } from "../store/topic.js";
import {
  appendEvent,
  readTranscript,
  type TranscriptEvent,
} from "../store/transcript.js";
import { resolvePerspectiveText } from "./charter.js";
import { selectMode } from "./modes.js";
import {
  buildDeltaPrompt,
  buildPrompt,
  deltaContext,
  extractStance,
  isSkip,
  lastOwnSeq,
  promptContext,
  stanceDigest,
} from "./prompt.js";

const CHARTER_FILE = "charter.md";
const DEFAULT_TIMEOUT_MS = 300_000;

/** 失败原因转短文本(截断),写入 error 事件 */
function errText(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 300 ? m.slice(0, 300) + "…" : m;
}

export interface RunOptions {
  /** 默认走注册表;测试可注入 mock 解析器 */
  resolveAdapter?: (spec: string) => ProviderAdapter;
  timeoutMs?: number;
  installSignalHandlers?: boolean;
  /** 每次 append 事件后回调;ctx.requestStop 模拟 SIGINT(测试用) */
  onEvent?: (event: TranscriptEvent, ctx: { requestStop: () => void }) => void;
}

/** 逐轮的立场快照:message → 立场行/截断;skip → 固定标记 */
function stanceMap(events: TranscriptEvent[], round: number): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of events) {
    if (e.round !== round || !e.from) continue;
    if (e.kind === "message") map.set(e.from, e.stance ?? (e.body ? stanceDigest(e.body) : ""));
    else if (e.kind === "skip" || e.kind === "error") map.set(e.from, "【跳过】"); // error 与 skip 同档(F1):未表态,不阻收敛
  }
  return map;
}

/** loop guard:全员跳过,或连续两轮全体立场完全相同 → 收敛 */
export function checkConverged(events: TranscriptEvent[], round: number): boolean {
  const cur = stanceMap(events, round);
  if (cur.size === 0) return false;
  if ([...cur.values()].every((v) => v === "【跳过】")) return true;
  if (round < 2) return false;
  const prev = stanceMap(events, round - 1);
  if (prev.size !== cur.size) return false;
  for (const [k, v] of cur) if (prev.get(k) !== v) return false;
  return true;
}

interface Progress {
  completedRounds: number;
  spokenInRound: Map<number, Set<string>>;
}

function computeProgress(events: TranscriptEvent[]): Progress {
  let completedRounds = 0;
  const spokenInRound = new Map<number, Set<string>>();
  for (const e of events) {
    if (e.kind === "round_end") completedRounds = Math.max(completedRounds, e.round);
    if ((e.kind === "message" || e.kind === "skip" || e.kind === "error") && e.from) {
      let set = spokenInRound.get(e.round);
      if (!set) spokenInRound.set(e.round, (set = new Set()));
      set.add(e.from);
    }
  }
  return { completedRounds, spokenInRound };
}

/**
 * 前台回合循环。持有 runner.lock,单写者 append transcript。
 * 开题(transcript 为空)先补 seq-1 system 事件(design §2 契约);continue 不重复写。
 * 暂停(SIGINT/requestStop):当前发言完成后落盘 status=paused、清锁、优雅退出。
 * 结束(maxRounds 到达 / 收敛 / inbox stop):status=completed,按模式收尾生成 summary.md。
 */
export async function runTopic(dir: string, opts: RunOptions = {}): Promise<Topic> {
  const resolve = opts.resolveAdapter ?? resolveAdapter;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const lock = acquireLock(dir);
  if (!lock.ok) throw new Error(`话题已有 runner 在跑(pid ${lock.holder.pid});若确信是残留,删除 runner.lock 后重试`);

  let pauseRequested = false;
  let endRequested = false;
  const requestStop = (): void => {
    pauseRequested = true;
  };
  const onSigint = (): void => {
    pauseRequested = true;
  };
  const installSignals = opts.installSignalHandlers ?? true;
  if (installSignals) process.on("SIGINT", onSigint);

  const emit = (event: TranscriptEvent): void => opts.onEvent?.(event, { requestStop });

  try {
    let topic = loadTopic(dir);
    if (topic.status === "completed") return topic;
    topic = transition(topic, "active");
    saveTopic(dir, topic);

    const adapters = new Map<string, ProviderAdapter>();
    for (const p of topic.participants) adapters.set(p.handle, resolve(p.provider));

    const charter = fs.existsSync(path.join(dir, CHARTER_FILE))
      ? fs.readFileSync(path.join(dir, CHARTER_FILE), "utf8")
      : `# 话题:${topic.title}`;

    // 开题补 seq-1 system 事件(design §2);transcript 非空即已开题,continue 不重复写。
    if (readTranscript(dir).length === 0) {
      emit(appendEvent(dir, {
        kind: "system",
        round: 0,
        body: `话题开启:${topic.title}(模式 ${topic.mode},最多 ${topic.maxRounds} 轮)`,
      }));
    }

    const progress = computeProgress(readTranscript(dir));
    const startRound = progress.completedRounds + 1;
    let converged = false;

    outer: for (let round = startRound; round <= topic.maxRounds; round++) {
      const already = progress.spokenInRound.get(round) ?? new Set<string>();
      for (const participant of topic.participants) {
        // 每位发言间隙消费 inbox:human 插话搬入 transcript,stop 请求结束
        drainInbox(dir, round, emit, () => {
          endRequested = true;
        });
        if (pauseRequested || endRequested) break outer;
        if (already.has(participant.handle)) continue;

        const speech = await speakOnce(dir, charter, topic, participant, adapters, round, timeoutMs);
        emit(speech.event);
        // 成功才更新 sessionRef/tokens;失败(F1)保留旧值,该参与者本轮跳过继续
        if (!speech.failed) {
          topic = updateParticipant(topic, participant.handle, speech);
          saveTopic(dir, topic);
        }
        if (pauseRequested || endRequested) break outer;
      }

      const roundEnd = appendEvent(dir, { kind: "round_end", round });
      emit(roundEnd);
      topic = { ...topic, currentRound: round };
      saveTopic(dir, topic);

      if (checkConverged(readTranscript(dir), round)) {
        converged = true;
        break;
      }
    }

    if (pauseRequested && !endRequested) {
      topic = transition(topic, "paused");
      saveTopic(dir, topic);
      return topic;
    }

    // 收尾:按模式分派(roundtable=末位总结 / debate=裁决轮)→ summary.md
    // finalize 失败(如裁决人 provider 挂)也要落确定态,不留 active(F1)
    try {
      topic = await selectMode(topic.mode).finalize({ dir, charter, topic, adapters, converged, timeoutMs, emit });
    } catch (err) {
      emit(appendEvent(dir, {
        kind: "error",
        round: topic.currentRound,
        body: `收尾失败: ${errText(err)}`,
      }));
    }
    topic = transition(topic, "completed");
    saveTopic(dir, topic);
    return topic;
  } finally {
    if (installSignals) process.off("SIGINT", onSigint);
    releaseLock(dir);
  }
}

function drainInbox(
  dir: string,
  round: number,
  emit: (e: TranscriptEvent) => void,
  onStop: () => void,
): void {
  const pending = readPending(dir);
  if (pending.length === 0) return;
  for (const entry of pending) {
    if (entry.kind === "stop") {
      onStop();
    } else if (entry.body !== undefined) {
      const event = appendEvent(dir, { kind: "human", round, from: entry.from, body: entry.body });
      emit(event);
    }
  }
  markConsumed(dir, pending[pending.length - 1]!.id);
}

interface SpeechResult {
  event: TranscriptEvent;
  sessionRef: string;
  tokens: { input: number; cached: number; output: number };
  /** 该参与者本轮失败(已记 error 事件),调用方跳过更新其 sessionRef/tokens 并继续 */
  failed?: boolean;
}

async function speakOnce(
  dir: string,
  charter: string,
  topic: Topic,
  participant: Participant,
  adapters: Map<string, ProviderAdapter>,
  round: number,
  timeoutMs: number,
): Promise<SpeechResult> {
  const adapter = adapters.get(participant.handle)!;
  const transcript = readTranscript(dir);
  const self = { handle: participant.handle, perspective: resolvePerspectiveText(participant.perspective) };
  const ownSeq = lastOwnSeq(transcript, participant.handle);
  // 增量模式(R4b):会话已续接且此前发过言 → 只发新增,不重发 charter/历史;否则全量
  let prompt: string;
  if (participant.sessionRef && ownSeq > 0) {
    prompt = buildDeltaPrompt({
      self,
      round,
      maxRounds: topic.maxRounds,
      newSpeeches: deltaContext(transcript, ownSeq),
    });
  } else {
    const ctx = promptContext(transcript, round);
    prompt = buildPrompt({
      charter,
      self,
      round,
      maxRounds: topic.maxRounds,
      stanceSummary: ctx.stanceSummary,
      recent: ctx.recent,
    });
  }
  let result: SpeakResult;
  try {
    result = await adapter.speak({
      prompt,
      sessionRef: participant.sessionRef ?? undefined,
      model: participant.model ?? undefined,
      cwd: topic.repo ?? dir,
      codeAccess: !!topic.repo,
      timeoutMs,
    });
  } catch (err) {
    // 单点失败降级(F1):记 error 事件,该参与者本轮跳过,讨论继续
    const event = appendEvent(dir, { kind: "error", round, from: participant.handle, body: errText(err) });
    return { event, sessionRef: participant.sessionRef ?? "", tokens: participant.tokens, failed: true };
  }
  const tokens = {
    input: participant.tokens.input + (result.tokens?.input ?? 0),
    cached: participant.tokens.cached + (result.tokens?.cached ?? 0),
    output: participant.tokens.output + (result.tokens?.output ?? 0),
  };
  const event = isSkip(result.text)
    ? appendEvent(dir, { kind: "skip", round, from: participant.handle })
    : appendEvent(dir, {
        kind: "message",
        round,
        from: participant.handle,
        body: result.text,
        ...(extractStance(result.text) ? { stance: extractStance(result.text)! } : {}),
      });
  return { event, sessionRef: result.sessionRef, tokens };
}

function updateParticipant(topic: Topic, handle: string, speech: SpeechResult): Topic {
  return {
    ...topic,
    participants: topic.participants.map((p) =>
      p.handle === handle ? { ...p, sessionRef: speech.sessionRef, tokens: speech.tokens } : p,
    ),
  };
}
