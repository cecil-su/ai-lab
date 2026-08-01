import fs from "node:fs";
import path from "node:path";
import { resolveAdapter } from "../adapters/registry.js";
import { readTranscriptDetailed } from "../store/transcript.js";
import { evidenceIndex } from "./modes.js";
import { truncateBody } from "./prompt.js";

const SUMMARY_FILE = "summary.md";

export interface AuditItem {
  /** summary 中被抽检的结论句(截断) */
  claim: string;
  /** 模型判定:支撑 / 存疑 / 无支撑 */
  verdict: "support" | "doubt" | "unsupported";
  /** 判定的依据(引用的 seq 或说明) */
  reason: string;
}

export interface AuditReport {
  ok: boolean;
  items: AuditItem[];
  /** 使用的 provider */
  provider: string;
  error?: string;
}

/** 从模型回答中提取 JSON 数组(容忍前后说明文字) */
export function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error(`模型未返回 JSON 数组: ${text.slice(0, 120)}`);
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

/**
 * 语义抽检(体验 C):summary 结论逐条对照 transcript 证据,判定 支撑/存疑/无支撑。
 * 与 verify(引用完整性)互补——verify 只保证 [seq N] 可解析,audit 抽检"结论是否被证据支撑"。
 * 由单模型执行(默认 reasonix flash,便宜快);输出结构化 JSON 供展示。
 */
export async function auditSummary(
  dir: string,
  opts: { providerSpec?: string; timeoutMs?: number },
): Promise<AuditReport> {
  const providerSpec = opts.providerSpec ?? "reasonix@deepseek/deepseek-v4-flash";
  const at = providerSpec.lastIndexOf("@");
  const base = at > 0 ? providerSpec.slice(0, at) : providerSpec;
  const model = at > 0 ? providerSpec.slice(at + 1) : undefined;
  const adapter = resolveAdapter(base);

  const summaryFile = path.join(dir, SUMMARY_FILE);
  if (!fs.existsSync(summaryFile)) {
    return { ok: false, items: [], provider: base, error: "无 summary.md" };
  }
  const summary = fs.readFileSync(summaryFile, "utf8");
  const detail = readTranscriptDetailed(dir);
  const index = evidenceIndex(detail.events, detail.badLines);
  const prompt = `你是评审抽检员。以下是讨论总结、证据索引与关键发言。请把总结中的每条**结论/主张**(不含证据索引本身)逐条判定:
- support:该主张被证据索引或发言明确支撑
- doubt:部分支撑或证据含糊
- unsupported:无证据支撑或与证据矛盾

输出严格 JSON 数组(不要其他文字):
[{"claim":"<结论句,30字内>","verdict":"support|doubt|unsupported","reason":"<依据,引用 seq>"}]

## 总结
${truncateBody(summary, 3000)}

## 证据索引与发言
${truncateBody(index, 4000)}`;

  try {
    const result = await adapter.speak({
      prompt,
      cwd: dir,
      timeoutMs: opts.timeoutMs ?? 300_000,
      model,
    });
    const text = result.text.trim();
    let parsed: unknown;
    try {
      parsed = extractJsonArray(text);
    } catch (e) {
      return { ok: false, items: [], provider: base, error: e instanceof Error ? e.message : String(e) };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, items: [], provider: base, error: "模型返回非数组" };
    }
    const items = parsed.map((i) => ({
      claim: String(i.claim ?? "").slice(0, 60),
      verdict: (["support", "doubt", "unsupported"].includes(i.verdict) ? i.verdict : "doubt") as AuditItem["verdict"],
      reason: String(i.reason ?? "").slice(0, 120),
    }));
    return { ok: true, items, provider: base };
  } catch (e) {
    return { ok: false, items: [], provider: base, error: e instanceof Error ? e.message : String(e) };
  }
}
