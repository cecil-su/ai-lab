# agent-roundtable: transcript 升为恢复源 / topic.json 降级为 projection (Phase-3 ①)

## Goal

补齐 ADR 0030 第二阶段：让 `transcript.jsonl` 成为可恢复的真相源，`topic.json` 降级为可重建的 checkpoint/projection，消除"跨文件多步写入崩溃后状态只能靠猜"的最后架构缺口。

## Background

当前持久化模型：一次发言 = `appendEvent(transcript)` + `saveTopic(topic.json)` 两步提交。崩溃落在两步之间时：
- transcript 说"已发言"（恢复时跳过该轮），topic.json 仍持旧 sessionRef/tokens → 增量续接可能用旧会话排除已写入的自身发言，token 少计；
- 无法可靠重建 sessionRef/tokens。

## Requirements

1. **提交元数据入 transcript**：每个 `message` 事件携带该次发言提交的 `sessionRef`（结构化）与 token 增量（input/cached/output），可选 `seq` 引用。
2. **topic.json 降级为 projection**：所有参与者的 sessionRef/tokens 可从 transcript 事件重放推导；`currentRound`/`resumeFromSeq`/`finalization` 等进度字段保留为 checkpoint（不追溯）。
3. **崩溃恢复**：启动/continue 时若发现 topic.json 与 transcript 不一致（如缺失提交元数据代际、round 落后），从 transcript 重建 participant 派生字段并持久化；无法重建的会话（旧代无元数据）降级为全量新会话（已有 isTrustedRef 闸门复用）。
4. **向后兼容**：旧 transcript 无元数据的事件不破坏读取；旧 topic.json 缺字段按现有默认补齐，不 bump version 前先评估（若 event 结构变化需 v2 事件字段 optional）。

## Constraints

- 不引入数据库/WAL/事件溯源框架（ADR 0030 决策不变）。
- 保持"单写者 = runner"的 transcript 追加语义与 seq 严格递增。
- 不改 summary.md 产出逻辑。
- 与 Phase-3 ②(resumableSession) 不互相阻塞；若冲突以 ① 的提交元数据为准。

## Acceptance Criteria

- [ ] 每个 message 事件落盘时包含结构化 sessionRef + token 增量（向后兼容读）。
- [ ] 构造"appendEvent 成功、saveTopic 前崩溃"的现场，`continue` 后参与者 sessionRef/tokens 与 transcript 一致（或明确降级全量新会话并告警），不出现"跳过发言却用旧会话增量"。
- [ ] topic.json 可从 transcript 重放重建 participant 派生字段的纯函数 + 单测（含旧代无元数据事件）。
- [ ] 全量测试通过，无回归。

## Notes

- 关联：ADR 0030、`.trellis/spec/engine/roundtable-engine-invariants.md`。
- 大改动，先 design.md 定 schema 再动手。
