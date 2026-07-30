import path from "node:path";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { opencodeAdapter } from "./opencode.js";
import { reasonixAdapter } from "./reasonix.js";
import { createMockAdapter } from "./mock.js";
import type { ProviderAdapter } from "./types.js";

// provider spec 语法:
//   "claude" | "codex" | "opencode" | "reasonix"  → 真实 CLI 适配器
//   "mock:<脚本路径>"                               → 确定性 mock(测试/演示,零真实 token)
// mock 路径以冒号后半段给出;normalizeSpec 会把相对路径转成绝对路径存入 topic.json,保证 continue 跨 cwd 可用。
const REAL: Record<string, ProviderAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  reasonix: reasonixAdapter,
};

const MOCK_PREFIX = "mock:";

export function realAdapters(): ProviderAdapter[] {
  return Object.values(REAL);
}

export function isMockSpec(spec: string): boolean {
  return spec.startsWith(MOCK_PREFIX);
}

/** provider spec 的展示用基名(mock:xx → "mock") */
export function providerBase(spec: string): string {
  return isMockSpec(spec) ? "mock" : spec;
}

/** mock 相对路径转绝对,便于 continue 时从任意 cwd 解析;真实 provider 原样返回 */
export function normalizeSpec(spec: string, cwd: string): string {
  if (!isMockSpec(spec)) {
    if (!(spec in REAL)) throw new Error(`未知 provider: ${spec}(可选 ${Object.keys(REAL).join("/")} 或 mock:<脚本>)`);
    return spec;
  }
  return MOCK_PREFIX + path.resolve(cwd, spec.slice(MOCK_PREFIX.length));
}

export function resolveAdapter(spec: string): ProviderAdapter {
  if (isMockSpec(spec)) return createMockAdapter(spec.slice(MOCK_PREFIX.length));
  const adapter = REAL[spec];
  if (!adapter) throw new Error(`未知 provider: ${spec}`);
  return adapter;
}
