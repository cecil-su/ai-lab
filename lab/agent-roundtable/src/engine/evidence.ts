import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readTranscriptDetailed, TRANSCRIPT_FILE } from "../store/transcript.js";

const SUMMARY_FILE = "summary.md";

export interface EvidenceRef {
  seq: number;
  line: string;
  /** ok=存在且为发言/裁决事件;dangling=悬空(不存在);wrong-kind=存在但非发言/裁决(误引) */
  status: "ok" | "dangling" | "wrong-kind";
}

export interface EvidenceReport {
  ok: boolean;
  refs: EvidenceRef[];
  /** 坏行数:存在时整体降级(丢失事件不可确认,引用可能不完整) */
  badLines: number[];
  /** 生成时刻的 transcript 快照指纹(sha256):验证必须绑定快照,防止事后修复掩盖真实悬空 */
  transcriptHash: string;
  /** 提供 expectHash 时:当前文件 hash 与生成时刻一致? */
  hashMatch: boolean;
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
 * 不验证语义支撑(需要模型/人抽检),只验证"引用可解析"。
 */
export function verifyEvidence(dir: string, opts: { expectHash?: string } = {}): EvidenceReport {
  const summaryFile = path.join(dir, SUMMARY_FILE);
  const summary = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, "utf8") : "";
  const { events, badLines } = readTranscriptDetailed(dir);
  const seqMap = new Map(events.map((e) => [e.seq, e]));

  const refs: EvidenceRef[] = extractRefs(summary).map((seq) => {
    const e = seqMap.get(seq);
    if (!e) return { seq, line: "", status: "dangling" };
    const isSpeech = e.kind === "message" || e.kind === "skip" || e.kind === "verdict";
    return {
      seq,
      line: `${e.kind} R${e.round}${e.from ? ` ${e.from}` : ""}`,
      status: isSpeech ? "ok" : "wrong-kind",
    };
  });

  const transcriptHash = transcriptFingerprint(dir);
  const hashMatch = opts.expectHash === undefined || opts.expectHash === transcriptHash;
  const ok = refs.every((r) => r.status === "ok") && badLines.length === 0 && hashMatch;
  return { ok, refs, badLines, transcriptHash, hashMatch, totalRefs: refs.length };
}
