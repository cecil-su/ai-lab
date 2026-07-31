import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadTopic } from "../store/topic.js";
import { readTranscriptDetailed, TRANSCRIPT_FILE } from "../store/transcript.js";

const SUMMARY_FILE = "summary.md";

export interface EvidenceRef {
  seq: number;
  line: string;
  /** 被引用事件的 kind(message/skip/verdict) */
  kind: string;
  /** ok=存在且为发言/裁决事件;dangling=悬空(不存在);wrong-kind=存在但非发言/裁决(误引) */
  status: "ok" | "dangling" | "wrong-kind";
}

export interface EvidenceReport {
  ok: boolean;
  refs: EvidenceRef[];
  /** 坏行数:存在时整体降级(丢失事件不可确认,引用可能不完整) */
  badLines: number[];
  /** 生成时刻的 transcript 快照指纹(sha256):引擎在 finalize 后写入 topic.json summaryEvidence */
  transcriptHash: string;
  /** 当前文件 hash 与生成时刻(元数据或 expectHash)一致? */
  hashMatch: boolean;
  /** 是否有生成时刻绑定(引擎元数据或 expectHash 提供) */
  evidenceBound: boolean;
  totalRefs: number;
}

/** 从 summary 提取所有 `[seq N]` 引用(证据索引格式) */
export function extractRefs(summary: string): number[] {
  const seqs: number[] = [];
  for (const m of summary.matchAll(/\[seq (\d+)\]/g)) seqs.push(Number(m[1]));
  return seqs;
}

export function transcriptFingerprint(dir: string): string {
  const file = path.join(dir, TRANSCRIPT_FILE);
  if (!fs.existsSync(file)) return crypto.createHash("sha256").digest("hex");
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * 旁路引用验证器(真机模型验收标准):独立于 summary 生成路径,
 * 读 transcript + summary,对每条 `[seq N]` 引用做三态判定。
 * 终审③④:零引用不得通过;须至少一条指向参与者 message 的引用(verdict/skip 不能单独背书);
 * hash 默认绑定引擎写入的 summaryEvidence(旧话题无绑定 → 不可验证,不默认通过)。
 */
export function verifyEvidence(dir: string, opts: { expectHash?: string } = {}): EvidenceReport {
  const summaryFile = path.join(dir, SUMMARY_FILE);
  const summary = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, "utf8") : "";
  const { events, badLines } = readTranscriptDetailed(dir);
  const seqMap = new Map(events.map((e) => [e.seq, e]));

  const refs: EvidenceRef[] = extractRefs(summary).map((seq) => {
    const e = seqMap.get(seq);
    if (!e) return { seq, line: "", kind: "", status: "dangling" };
    const isSpeech = e.kind === "message" || e.kind === "skip" || e.kind === "verdict";
    return {
      seq,
      line: `${e.kind} R${e.round}${e.from ? ` ${e.from}` : ""}`,
      kind: e.kind,
      status: isSpeech ? "ok" : "wrong-kind",
    };
  });

  // 终审④:生成时刻绑定 = 引擎元数据(summaryEvidence)或显式 expectHash;旧话题无绑定 → 不可验证
  let metaHash: string | undefined;
  try {
    metaHash = loadTopic(dir).summaryEvidence?.transcriptHash;
  } catch {
    // 无 topic.json(孤立目录/测试夹具)→ 无引擎绑定,不抛错
  }
  const boundHash = opts.expectHash ?? metaHash;
  const transcriptHash = transcriptFingerprint(dir);
  const hashMatch = boundHash === undefined || boundHash === transcriptHash;

  // 终审③:零引用不得通过;至少一条指向参与者 message 的引用(verdict/skip 不能单独背书)
  const hasMessageEvidence = refs.some((r) => r.status === "ok" && r.kind === "message");
  const ok =
    refs.length > 0 &&
    hasMessageEvidence &&
    refs.every((r) => r.status === "ok") &&
    badLines.length === 0 &&
    hashMatch &&
    boundHash !== undefined;
  return {
    ok,
    refs,
    badLines,
    transcriptHash,
    hashMatch,
    evidenceBound: boundHash !== undefined,
    totalRefs: refs.length,
  };
}
