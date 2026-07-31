# agent-roundtable: 4模型自我迭代反馈落地

## Goal

把 4 工具 debate（claude/codex/opencode/reasonix，2026-07-31）的裁决共识转化为代码/测试/spec 迭代。

## 裁决要点 → 落地项

1. **收敛熔断降级为节费优化，不承诺成本安全**（4 方共识）：
   - 行为保留（stance 全等判定），补两条确定性断言测试（相同 stance 两轮必触发 / 措辞变化必不触发）。
   - spec/README 明确：收敛是优化，成本安全需确定性护栏（预算/调用上限）。
2. **debate 裁决人作废错位**（opencode 发现）：runner finalize catch 对 debate 清末位参与者（裁决人是临时身份不入 participants）→ 仅 roundtable 清末位总结者。
3. **outcome/failures 语义定义**（opencode/codex）：spec 定义 outcome 反映生命周期失败史；failures 为全生命周期累计（token 下界依据，非本代失败数）。
4. **mock 脚本化故障序列**（reasonix）：speeches 支持 `{fail}` 步骤，按调用轮次注入失败，零新基建验证降级/熔断路径。
5. （后续，不在本任务）预算闭环与取消点、detach。

## Acceptance Criteria

- [ ] checkConverged 两条判定断言测试通过。
- [ ] debate finalize 失败不再清除参与者 ref（roundtable 行为不变）；有回归测试。
- [ ] spec 补 outcome/failures 语义定义。
- [ ] mock 故障步骤 + 引擎降级路径测试通过。
- [ ] 全量测试通过，无回归。

## Notes

- 反馈来源：话题 `2026-07-31-agent-roundtable-自身迭代-下一阶段改进方向`（transcript 13 事件，claude-judge 裁决）。
