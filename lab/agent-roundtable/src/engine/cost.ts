/**
 * 成本估算(用户体验 A):开跑前 token 区间预告。
 * 基线为 2026-07-31 单模型对比实测 input/次(不含历史上下文膨胀):
 *   claude ~8k / codex ~40k / opencode ~13k / reasonix ~23k / mock 0
 * 区间 = 基线 × 预估调用数 × [0.5(增量轮), 1.5(全量轮+材料)] —— 保守下界/上界。
 * 失败调用的 token 以下界计,不可预测(与预算语义一致)。
 */

export const INPUT_BASELINE: Record<string, number> = {
  claude: 8_000,
  codex: 40_000,
  opencode: 13_000,
  reasonix: 23_000,
  mock: 0,
};

export interface TokenEstimate {
  low: number;
  high: number;
  calls: number;
}

/** 每参与者预估调用数 = 轮数 + 收尾(roundtable 1 / debate 2;裁决人计入一次独立调用) */
export function callsPerParticipant(rounds: number, finalizeCalls: number): number {
  return rounds + finalizeCalls;
}

export function estimateTokenRange(
  providers: string[],
  rounds: number,
  finalizeCalls: number,
): TokenEstimate {
  const calls = providers.length * callsPerParticipant(rounds, finalizeCalls) + (finalizeCalls > 1 ? 1 : 0); // debate 裁决人额外一次
  const baseSum = providers.reduce((s, p) => s + (INPUT_BASELINE[p] ?? 10_000), 0);
  return {
    low: Math.round(baseSum * callsPerParticipant(rounds, finalizeCalls) * 0.5),
    high: Math.round(baseSum * callsPerParticipant(rounds, finalizeCalls) * 1.5 + (finalizeCalls > 1 ? INPUT_BASELINE[providers[0] ?? "claude"] ?? 8_000 : 0)),
    calls,
  };
}

export function formatTokenRange(e: TokenEstimate): string {
  const k = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));
  return `预计 input 约 ${k(e.low)}~${k(e.high)} tokens(约 ${e.calls} 次调用;失败以下界计,不可预测)`;
}
