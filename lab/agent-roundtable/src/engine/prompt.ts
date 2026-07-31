// 发言 prompt 组装(design §4):charter 全文 + 历史立场摘要 + 上一轮全文 + 身份 + 发言协议。
// 立场行提取/截断为纯函数,供 runner 压缩历史与 loop guard 复用。

import type { TranscriptEvent } from "../store/transcript.js";

const STANCE_RE = /^\s*【立场】\s*(.*\S)\s*$/;
const SKIP_MARKER = "【跳过】";

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

/**
 * 仅当整段正文(trim 后)严格等于单行跳过标记时判为 skip;
 * 含其他内容(如否定句「我不选择【跳过】」、引用协议 marker、多行正文)必须保留为 message,
 * 不得用子串匹配静默丢弃正文。
 */
export function isSkip(body: string): boolean {
  return body.trim() === SKIP_MARKER;
}

// R4c 旋钮:单条引用发言的最大字数,超出截断(压制 token)
export const QUOTE_MAX_CHARS = 2000;

/** 引用他人发言时按上限截断,超出附省略标记 */
export function clampQuote(body: string, max = QUOTE_MAX_CHARS): string {
  const t = body.trim();
  return t.length <= max ? t : t.slice(0, max) + "\n…(已截断)";
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
    "- 控制篇幅:聚焦要点,单次发言尽量不超过 600 字。",
  ].join("\n");
}

export function buildPrompt(inp: BuildPromptInput): string {
  const parts: string[] = [inp.charter.trim()];

  if (inp.stanceSummary.length > 0) {
    const lines = inp.stanceSummary.map((s) => `- 第${s.round}轮 ${s.from}:【立场】${s.stance}`);
    parts.push(`## 历史立场摘要\n${lines.join("\n")}`);
  }

  if (inp.recent.length > 0) {
    parts.push(`## 最近发言\n${renderSpeeches(inp.recent)}`);
  } else {
    parts.push("## 最近发言\n(本轮为首轮,暂无历史发言)");
  }

  parts.push(`## 你的身份\n你是「${inp.self.handle}」,视角:${inp.self.perspective}`);
  parts.push(protocol(inp.round, inp.maxRounds));
  return parts.join("\n\n");
}

function speechTag(kind: RecentSpeech["kind"]): string {
  return kind === "human" ? "(人类插话)" : kind === "skip" ? "(跳过)" : kind === "verdict" ? "(裁决)" : "";
}

function renderSpeeches(speeches: RecentSpeech[]): string {
  return speeches.map((r) => `### ${r.from}${speechTag(r.kind)}\n${clampQuote(r.body)}`).join("\n\n");
}

export interface DeltaPromptInput {
  self: PromptSelf;
  round: number;
  maxRounds: number;
  /** 该参与者上次发言之后的新增发言(不含 charter/历史;会话已持有) */
  newSpeeches: RecentSpeech[];
}

/**
 * 增量 prompt(R4b):仅发"上次发言后的新增内容 + 身份提醒 + 协议",不重发 charter/历史。
 * 前提是该参与者经 --resume 已在自身会话里持有 charter 与更早简报。
 */
export function buildDeltaPrompt(inp: DeltaPromptInput): string {
  const parts: string[] = [];
  if (inp.newSpeeches.length > 0) {
    parts.push(`## 最新进展(你上次发言后)\n${renderSpeeches(inp.newSpeeches)}`);
  } else {
    parts.push("## 最新进展\n(你上次发言后暂无他人新发言)");
  }
  parts.push(`## 你的身份\n你是「${inp.self.handle}」,视角:${inp.self.perspective}`);
  parts.push(protocol(inp.round, inp.maxRounds));
  return parts.join("\n\n");
}

/** 组装某轮 prompt 的上下文:历史立场摘要(1..round-2)+ 最近窗口(round-1 起全文) */
export function promptContext(
  events: TranscriptEvent[],
  round: number,
  sinceSeq = 0,
): { stanceSummary: StanceLine[]; recent: RecentSpeech[] } {
  const stanceSummary: StanceLine[] = [];
  const recent: RecentSpeech[] = [];
  for (const e of events) {
    if (e.seq <= sinceSeq) continue; // F9:续谈水位线下界,挡住旧裁决/旧收尾回流
    if (e.kind === "message" && e.from && e.round >= 1 && e.round <= round - 2) {
      stanceSummary.push({ round: e.round, from: e.from, stance: e.stance ?? (e.body ? stanceDigest(e.body) : "") });
    }
    if (e.round >= round - 1 && e.from && e.body !== undefined && (e.kind === "message" || e.kind === "human" || e.kind === "verdict" || e.kind === "skip")) {
      recent.push({ from: e.from, body: e.body, kind: e.kind });
    }
  }
  return { stanceSummary, recent };
}

/** 某 handle 最近一次自身发言(message/skip)的 seq;从未发言返回 0 */
export function lastOwnSeq(events: TranscriptEvent[], handle: string): number {
  let seq = 0;
  for (const e of events) {
    if (e.from === handle && (e.kind === "message" || e.kind === "skip")) seq = Math.max(seq, e.seq);
  }
  return seq;
}

/** 增量上下文:lastOwnSeq 之后的新增发言(该参与者尚未见过的) */
export function deltaContext(events: TranscriptEvent[], sinceSeq: number): RecentSpeech[] {
  const out: RecentSpeech[] = [];
  for (const e of events) {
    if (e.seq <= sinceSeq || !e.from || e.body === undefined) continue;
    if (e.kind === "message" || e.kind === "human" || e.kind === "verdict" || e.kind === "skip") {
      out.push({ from: e.from, body: e.body, kind: e.kind });
    }
  }
  return out;
}
