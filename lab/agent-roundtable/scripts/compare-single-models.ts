// 单模型对比:同一问题 + 同一注入材料,分别用 4 家 adapter 新会话跑一次。
// 与 4 模型 debate 的发现清单对照,评估"单模型 vs 多模型对抗"的价值差。
// ⚠️ 消耗真实 token。用法:pnpm -F agent-roundtable tsx scripts/compare-single-models.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeAdapter } from "../src/adapters/claude.js";
import { codexAdapter } from "../src/adapters/codex.js";
import { opencodeAdapter } from "../src/adapters/opencode.js";
import { reasonixAdapter } from "../src/adapters/reasonix.js";
import type { ProviderAdapter } from "../src/adapters/types.js";

const TIMEOUT_MS = 300_000;
const MODELS: Record<string, { adapter: ProviderAdapter; model?: string }> = {
  claude: { adapter: claudeAdapter, model: "claude-opus-4-8" },
  codex: { adapter: codexAdapter, model: "gpt-5.6-sol" },
  opencode: { adapter: opencodeAdapter, model: "openai/gpt-5.6-sol" },
  reasonix: { adapter: reasonixAdapter, model: "deepseek/deepseek-v4-flash" },
};

const MATERIALS = [
  "D:/Workspace/ai/ai-lab/apps/codex-skill-board/IMPLEMENTATION_PLAN.md",
  "D:/Workspace/ai/ai-lab/apps/codex-skill-board/server/db.ts",
  "D:/Workspace/ai/ai-lab/apps/codex-skill-board/server/index.ts",
  "D:/Workspace/ai/ai-lab/apps/codex-skill-board/package.json",
];

const QUESTION = `评审 codex-skill-board 的实现(以下材料为 IMPLEMENTATION_PLAN.md、server/db.ts、server/index.ts、package.json)。请输出:
1. 最严重的 3-5 个问题(按严重度排序,注明涉及哪个文件/函数)
2. MVP 范围建议(哪些该砍/该降级/该保留)
3. 下一步行动项(具体可执行,按优先级)
要求:具体、可落地,不要泛泛而谈。`;

function buildPrompt(): string {
  const parts = [QUESTION, "", "## 材料", ""];
  for (const f of MATERIALS) {
    const content = fs.readFileSync(f, "utf8");
    parts.push(`### ${path.basename(f)} (${(content.length / 1024).toFixed(1)} KB)`, "", "```", content, "```", "");
  }
  return parts.join("\n");
}

interface CompareReport {
  name: string;
  model: string;
  ms: number;
  tokens: { input: number; cached: number; output: number };
  text: string;
}

async function runOne(name: string, entry: { adapter: ProviderAdapter; model?: string }, prompt: string): Promise<CompareReport> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `rt-compare-${name}-`));
  const started = Date.now();
  try {
    const result = await entry.adapter.speak({ prompt, cwd, timeoutMs: TIMEOUT_MS, model: entry.model });
    return {
      name,
      model: entry.model ?? "default",
      ms: Date.now() - started,
      tokens: { input: result.tokens?.input ?? 0, cached: result.tokens?.cached ?? 0, output: result.tokens?.output ?? 0 },
      text: result.text,
    };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

const prompt = buildPrompt();
console.log(`prompt 材料 ${(prompt.length / 1024).toFixed(1)} KB\n`);
const reports: CompareReport[] = [];
for (const [name, entry] of Object.entries(MODELS)) {
  console.log(`=== ${name} (${entry.model}) ===`);
  const r = await runOne(name, entry, prompt);
  console.log(`  耗时 ${(r.ms / 1000).toFixed(1)}s  in=${r.tokens.input} cached=${r.tokens.cached} out=${r.tokens.output}`);
  reports.push(r);
}
const outFile = path.join(os.tmpdir(), "roundtable-single-compare.json");
fs.writeFileSync(outFile, JSON.stringify(reports, null, 2));
console.log(`\n报告已写入 ${outFile}`);
