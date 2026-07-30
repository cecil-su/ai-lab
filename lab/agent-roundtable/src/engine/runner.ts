import fs from "node:fs";
import path from "node:path";
import { resolveAdapter } from "../adapters/registry.js";
import type { ProviderAdapter, SpeakResult } from "../adapters/types.js";
import { readInboxRaw, consumedUpTo, markConsumed } from "../store/inbox.js";
import { acquireLock, releaseLock } from "../store/lock.js";
import { loadTopic, saveTopic, transition, type Participant, type Topic } from "../store/topic.js";
import {
  appendEvent,
  readTranscript,
  type TranscriptEvent,
} from "../store/transcript.js";
import { resolvePerspectiveText } from "./charter.js";
import { selectMode, writeFallbackSummary } from "./modes.js";
import { isTrustedRef } from "./session-trust.js";
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
// A1:某参与者连续失败达此阈值 → 自动暂停(防作废 ref 后无休止全量重发烧钱)
const FAILURE_CIRCUIT_THRESHOLD = 3;

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
  const consecutiveFail = new Map<string, number>(); // A1:每参与者连续失败计数(transient)
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
    // F9:起始轮取 max(已完成轮, currentRound)+1 —— 续谈重开时 currentRound 已推过裁决轮,
    // 避免新交锋轮与旧裁决轮同号(否则 checkConverged 可能立即腰斩追问轮)。
    const startRound = Math.max(progress.completedRounds, topic.currentRound) + 1;
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

        const speech = await speakOnce(dir, charter, topic, participant, adapters, round, timeoutMs, emit);
        emit(speech.event);
        // 成功才更新 sessionRef/tokens;失败(F1/F8)作废该参与者会话 → 下轮全量新会话
        if (!speech.failed) {
          topic = updateParticipant(topic, participant.handle, speech);
          consecutiveFail.set(participant.handle, 0);
        } else {
          topic = clearSession(topic, participant.handle);
          topic = bumpFailures(topic, participant.handle);
          const n = (consecutiveFail.get(participant.handle) ?? 0) + 1;
          consecutiveFail.set(participant.handle, n);
          // A1:连续失败熔断 → 自动 paused(非 TTY 不提问,防吊死);给一句损失评估(计量为下界)
          if (n >= FAILURE_CIRCUIT_THRESHOLD) {
            const p = topic.participants.find((x) => x.handle === participant.handle)!;
            const spent = p.tokens.input + p.tokens.cached + p.tokens.output;
            emit(appendEvent(dir, {
              kind: "system",
              round,
              body: `⚠ ${participant.handle} 连续 ${n} 轮失败,已消耗 ≥${spent} token(下界,失败调用未计),再续将继续全量重发。已自动暂停;修复后 continue 可续。`,
            }));
            pauseRequested = true;
          }
        }
        saveTopic(dir, topic);
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
      // 兜底 summary,避免 completed 却无产物(伪完成)。
      // #5:无条件覆盖,而非"存在即跳过"——续谈时旧代已产 summary.md,本代失败必须让用户看到,
      // 不能把旧结论当本代结论保留。
      writeFallbackSummary(
        dir,
        `讨论本身已完成,但收尾/裁决环节失败,未能生成正式总结。失败原因:${errText(err)}`,
      );
      // #5:收尾失败作废末位总结者的会话引用,避免续谈时带着可能失效/被污染的 ref 走增量
      topic = clearSession(topic, topic.participants[topic.participants.length - 1]!.handle);
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
  const { entries, totalLines, badLines } = readInboxRaw(dir);
  const cursor = consumedUpTo(dir);
  const pending = entries.filter((e) => e.line > cursor);
  const badInRange = badLines.filter((n) => n > cursor);
  if (pending.length === 0 && badInRange.length === 0) return;
  // A2:坏行(并发写入字节交错)落一条命名损失 error 事件,不静默跳过、也不因坏行自锁死整场
  for (const n of badInRange) {
    emit(appendEvent(dir, { kind: "error", round, body: `inbox 第 ${n} 行损坏,已跳过(可能丢失一条插话)` }));
  }
  for (const entry of pending) {
    if (entry.kind === "stop") {
      onStop();
    } else if (entry.body !== undefined) {
      const event = appendEvent(dir, { kind: "human", round, from: entry.from, body: entry.body });
      emit(event);
    }
  }
  markConsumed(dir, totalLines);
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
  emit: (e: TranscriptEvent) => void,
): Promise<SpeechResult> {
  const adapter = adapters.get(participant.handle)!;
  const transcript = readTranscript(dir);
  const self = { handle: participant.handle, perspective: resolvePerspectiveText(participant.perspective) };
  const ownSeq = lastOwnSeq(transcript, participant.handle);
  const trusted = isTrustedRef(participant.sessionRef);
  // F9:续谈水位线——prompt 事件下界取 max(自身上次发言, resumeFromSeq),挡住旧裁决/旧收尾回流。
  const floor = topic.resumeFromSeq ?? 0;
  // 增量模式(R4b):会话可信续接且此前发过言 → 只发新增;否则全量。
  // F4①/F8:仅当 sessionRef 可证为"该参与者自己的线程"才增量;降级哨兵(reasonix @last)不可信 → 回退全量+告警。
  let prompt: string;
  if (trusted && ownSeq > 0) {
    prompt = buildDeltaPrompt({
      self,
      round,
      maxRounds: topic.maxRounds,
      newSpeeches: deltaContext(transcript, Math.max(ownSeq, floor)),
    });
  } else {
    if (participant.sessionRef && !trusted && ownSeq > 0) {
      emit(appendEvent(dir, {
        kind: "system",
        round,
        body: `⚠ ${participant.handle} 会话降级(${participant.sessionRef}),本轮改发全量并新建会话以防串会话`,
      }));
    }
    const ctx = promptContext(transcript, round, floor);
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
      // F8:仅在可信时把旧 ref 交给 adapter 续接;降级 ref 传 undefined → 新会话,不再 -c 续错线程
      sessionRef: trusted ? (participant.sessionRef ?? undefined) : undefined,
      model: participant.model ?? undefined,
      cwd: topic.repo ?? dir,
      codeAccess: !!topic.repo,
      timeoutMs,
    });
  } catch (err) {
    // 单点失败降级(F1)+ F8:记 error 事件,并作废会话(failed → 调用方清空 sessionRef,下轮全量新会话)
    const event = appendEvent(dir, { kind: "error", round, from: participant.handle, body: errText(err) });
    return { event, sessionRef: "", tokens: participant.tokens, failed: true };
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

/** F8:作废某参与者的会话引用(失败/降级后下轮全量新会话);tokens 保留 */
function clearSession(topic: Topic, handle: string): Topic {
  return {
    ...topic,
    participants: topic.participants.map((p) =>
      p.handle === handle ? { ...p, sessionRef: null } : p,
    ),
  };
}

/** A1:累计某参与者失败次数(计量下界依据) */
function bumpFailures(topic: Topic, handle: string): Topic {
  return {
    ...topic,
    participants: topic.participants.map((p) =>
      p.handle === handle ? { ...p, failures: p.failures + 1 } : p,
    ),
  };
}
