// 发言 prompt 组装(design §4):charter 全文 + 历史立场摘要 + 上一轮全文 + 身份 + 发言协议。
// 立场行提取/截断为纯函数,供 runner 压缩历史与 loop guard 复用。

import type { TranscriptEvent } from "../store/transcript.js";

const STANCE_RE = /^\s*【立场】\s*(.*\S)\s*$/;
const SKIP_RE = /【跳过】/;

/** 从发言尾部提取一行【立场】<一句话>,返回一句话内容;缺失返回 null */
export function extractStance(body: string): string | null {
  const lines = body.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = STANCE_RE.exec(lines[i] ?? "");
    if (m) return m[1] ?? null;
  }
  return null;
}

/** 正文压成一行摘要:漏写【立场】时退化为正文前 max 字截断 */
export function truncateBody(body: string, max = 120): string {
  const clean = body.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : clean.slice(0, max) + "…";
}

/** 历史压缩用:优先立场行,否则截断 */
export function stanceDigest(body: string): string {
  return extractStance(body) ?? truncateBody(body);
}

export function isSkip(body: string): boolean {
  return SKIP_RE.test(body.trim());
}

export interface PromptSelf {
  handle: string;
  perspective: string;
}

export interface StanceLine {
  round: number;
  from: string;
  stance: string;
}

export interface RecentSpeech {
  from: string;
  body: string;
  kind: "message" | "human" | "verdict" | "skip";
}

export interface BuildPromptInput {
  charter: string;
  self: PromptSelf;
  round: number;
  maxRounds: number;
  stanceSummary: StanceLine[];
  recent: RecentSpeech[];
}

function protocol(round: number, maxRounds: number): string {
  return [
    "## 发言协议",
    `现在是第 ${round} / 最多 ${maxRounds} 轮讨论。请围绕议题发表本轮观点,要求简洁、有信息增量。`,
    "- 正文末尾必须另起一行输出你的立场,格式:【立场】<一句话立场>",
    "- 若本轮无新增信息,可只输出一行:【跳过】",
  ].join("\n");
}

export function buildPrompt(inp: BuildPromptInput): string {
  const parts: string[] = [inp.charter.trim()];

  if (inp.stanceSummary.length > 0) {
    const lines = inp.stanceSummary.map((s) => `- 第${s.round}轮 ${s.from}:【立场】${s.stance}`);
    parts.push(`## 历史立场摘要\n${lines.join("\n")}`);
  }

  if (inp.recent.length > 0) {
    const lines = inp.recent.map((r) => {
      const tag = r.kind === "human" ? "(人类插话)" : r.kind === "skip" ? "(跳过)" : "";
      return `### ${r.from}${tag}\n${r.body.trim()}`;
    });
    parts.push(`## 最近发言\n${lines.join("\n\n")}`);
  } else {
    parts.push("## 最近发言\n(本轮为首轮,暂无历史发言)");
  }

  parts.push(`## 你的身份\n你是「${inp.self.handle}」,视角:${inp.self.perspective}`);
  parts.push(protocol(inp.round, inp.maxRounds));
  return parts.join("\n\n");
}

/** 组装某轮 prompt 的上下文:历史立场摘要(1..round-2)+ 最近窗口(round-1 起全文) */
export function promptContext(
  events: TranscriptEvent[],
  round: number,
): { stanceSummary: StanceLine[]; recent: RecentSpeech[] } {
  const stanceSummary: StanceLine[] = [];
  const recent: RecentSpeech[] = [];
  for (const e of events) {
    if (e.kind === "message" && e.from && e.round >= 1 && e.round <= round - 2) {
      stanceSummary.push({ round: e.round, from: e.from, stance: e.stance ?? (e.body ? stanceDigest(e.body) : "") });
    }
    if (e.round >= round - 1 && e.from && e.body !== undefined && (e.kind === "message" || e.kind === "human" || e.kind === "verdict" || e.kind === "skip")) {
      recent.push({ from: e.from, body: e.body, kind: e.kind });
    }
  }
  return { stanceSummary, recent };
}
