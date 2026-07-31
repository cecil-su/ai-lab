// 四家真实 adapter 集成冒烟:每家两次最小调用(新会话 + 续接),验证记忆延续。
// ⚠️ 消耗真实 token。用法:pnpm -F agent-roundtable smoke:adapters [-- --only claude,codex]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeAdapter } from "../src/adapters/claude.js";
import { codexAdapter } from "../src/adapters/codex.js";
import { opencodeAdapter } from "../src/adapters/opencode.js";
import { reasonixAdapter } from "../src/adapters/reasonix.js";
import type { ProviderAdapter } from "../src/adapters/types.js";

const TIMEOUT_MS = 300_000;
const ADAPTERS: ProviderAdapter[] = [claudeAdapter, codexAdapter, opencodeAdapter, reasonixAdapter];

interface SmokeReport {
  name: string;
  status: "ok" | "fail" | "skip";
  detail: string;
  sessionRef?: string;
  memoryOk?: boolean;
  ms?: number;
  tokens?: string;
}

async function smokeOne(adapter: ProviderAdapter): Promise<SmokeReport> {
  const detection = await adapter.detect();
  if (!detection.ok) return { name: adapter.name, status: "skip", detail: "CLI 未检出,跳过" };

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `roundtable-smoke-${adapter.name}-`));
  const started = Date.now();
  try {
    const first = await adapter.speak({ prompt: "请只回复:PING1", cwd, timeoutMs: TIMEOUT_MS });
    const second = await adapter.speak({
      prompt: "你上一条回复了什么?只回答那个词",
      sessionRef: first.sessionRef,
      cwd,
      timeoutMs: TIMEOUT_MS,
    });
    const memoryOk = second.text.includes("PING1");
    const input = (first.tokens?.input ?? 0) + (second.tokens?.input ?? 0);
    const output = (first.tokens?.output ?? 0) + (second.tokens?.output ?? 0);
    return {
      name: adapter.name,
      status: memoryOk ? "ok" : "fail",
      detail: memoryOk
        ? `第一答=${JSON.stringify(first.text.slice(0, 40))} 第二答=${JSON.stringify(second.text.slice(0, 40))}`
        : `第二答未含 PING1: ${JSON.stringify(second.text.slice(0, 80))}`,
      sessionRef: first.sessionRef.value,
      memoryOk,
      ms: Date.now() - started,
      tokens: `in ${input} / out ${output}`,
    };
  } catch (err) {
    return {
      name: adapter.name,
      status: "fail",
      detail: (err as Error).message.split("\n").slice(0, 3).join(" | "),
      ms: Date.now() - started,
    };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx >= 0 ? new Set(process.argv[onlyIdx + 1]?.split(",") ?? []) : undefined;
  const targets = ADAPTERS.filter((a) => !only || only.has(a.name));
  if (targets.length === 0) {
    console.error(`--only 未匹配任何 adapter,可选: ${ADAPTERS.map((a) => a.name).join(",")}`);
    return 1;
  }

  const reports: SmokeReport[] = [];
  for (const adapter of targets) {
    console.log(`\n=== ${adapter.name} ===`);
    const report = await smokeOne(adapter);
    console.log(`  ${report.status}  ${report.detail}`);
    if (report.sessionRef) console.log(`  sessionRef: ${report.sessionRef}`);
    if (report.ms !== undefined) console.log(`  耗时: ${(report.ms / 1000).toFixed(1)}s  tokens: ${report.tokens ?? "?"}`);
    reports.push(report);
  }

  console.log("\n=== 汇总 ===");
  for (const r of reports) {
    const memory = r.memoryOk === undefined ? "-" : r.memoryOk ? "续上" : "断了";
    console.log(
      `  ${r.name.padEnd(10)} ${r.status.padEnd(5)} 记忆:${memory.padEnd(4)} ${r.ms !== undefined ? `${(r.ms / 1000).toFixed(1)}s` : ""} ${r.tokens ?? ""}`.trimEnd(),
    );
  }
  return reports.some((r) => r.status === "fail") ? 1 : 0;
}

process.exitCode = await main();
