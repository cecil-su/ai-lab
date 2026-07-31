# Implement — transcript 升为恢复源 / topic.json 降级为 projection (Phase-3 ①)

## 已完成

- [x] `SpeechCommit` schema：message/skip 成功与 error 失败事件携带 `commit:{sessionRef,tokens}`（累计值，向后兼容可选字段）。
- [x] `rebuildFromTranscript(events, handle)` 纯函数：按 seq 取最后一条 commit；failures = error 事件数；无 commit → null。
- [x] `runTopic` 启动对账：有 commit 且与 topic.json 不一致 → 覆盖 participant 派生字段并落盘；进度字段不追溯。
- [x] e2e：篡改 topic.json 模拟"appendEvent 后、saveTopic 前崩溃"→ continue 重开第一轮拿到 transcript commit 的 ref（而非陈旧值）。
- [x] spec：engine invariants 补"不变量 7：transcript commit 对账"。

## 验证

- [x] `pnpm -F agent-roundtable typecheck`
- [x] `pnpm -F agent-roundtable build`
- [x] `pnpm -F agent-roundtable test` — 152 passed / 3 skipped（21 files）
- [x] `git diff --check`

## Notes / 后续

- summarizer 最终 ref 不写 transcript（finalize 完成后 topic 不再对账回退）；若未来需要完整溯源可把 finalize 提交也事件化。
- 若进入无人值守/服务端场景，本方案可平滑升级为完整事件溯源（commit 字段已是雏形）。
