# agent-roundtable: capabilities 补 resumableSession 并持久化 (Phase-3 ②)

## Goal

ADR 0032 延伸：把"该 provider 的会话是否可以跨进程/跨目录可靠续接"从隐式假设变成显式能力声明，并持久化进 topic.json 供恢复/展示消费。

## Requirements

1. **能力声明**：`ProviderAdapter.capabilities` 增加 `resumableSession?: boolean`（缺省 = false）：
   - claude/codex：真（显式 session/thread id）；
   - opencode：真（session id）；reasonix：**假**（目录差集推断，仅唯一归属时才可信，且路径型 ref 不可跨机器）；
   - mock：假（计数器语义，无真实续接价值，但当前行为保留）。
2. **持久化**：createTopic 时把声明快照写入 topic（如 `capabilities?: Record<handle, { resumableSession: boolean }>`），避免运行期重判（与 inheritedProviders 同一原则）。
3. **消费点**：恢复/续谈决策（Phase-3 ① 的重建降级逻辑）用持久化声明替代运行时猜测；`doctor`/README 可展示。
4. **向后兼容**：旧 topic.json 无 capabilities → 缺省按声明真值表（claude/codex/opencode = resumable；reasonix/mock = 非）推导，不 bump version。

## Acceptance Criteria

- [ ] 四家 adapter 声明正确且有单测（registry 层）。
- [ ] createTopic 持久化能力快照；旧 topic 加载推导兼容。
- [ ] runner 消费点（至少一处：恢复降级判定）改用持久化声明。
- [ ] 全量测试通过，无回归。

## Notes

- 轻量任务，PRD-only 亦可；如与 ① 的提交元数据耦合则按 ① 设计为准。
