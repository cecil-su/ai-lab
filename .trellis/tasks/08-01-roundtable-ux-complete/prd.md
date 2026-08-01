# agent-roundtable: 用户体验完善 (A/B/C)

## A. 成本 token 区间预告

- 现状:开跑前只显示调用次数。
- 完善:基于实测基线表(2026-07-31 单模型对比:claude ~8k / codex ~40k / opencode ~13k / reasonix ~23k input/次)估算 token 区间,标注"失败以下界计,不可预测"。
- 纯函数 `estimateTokenRange` 可单测。

## B. 观察面完善

- `list`:显示 calls/maxCalls、evidence 状态(已绑定/不可验证)。
- `show --summary`:直接打印 summary.md。
- `verify`:文本输出补 evidenceBound 与 generation。

## C. audit 语义抽检

- 新命令 `roundtable audit <topic> [--provider <spec>]`(默认 reasonix flash):summary 结论逐条对照 transcript 证据,输出 支撑/存疑/无支撑 判定。
- 复用单模型 speak;与 verify(引用完整性)互补为"语义支撑度"。

## Acceptance

- [ ] A:开跑前打印 token 区间(纯函数单测:基线/轮数/模式)。
- [ ] B:list --json/文本含 calls 与 evidence 状态;show --summary 可用;verify 显示绑定信息。
- [ ] C:audit 命令输出逐条判定(真机验证一次,不阻塞单测)。
- [ ] 全量测试通过。
