# Design — transcript 升为恢复源 / topic.json 降级为 projection (Phase-3 ①)

## 目标

消除"appendEvent 成功、saveTopic 前崩溃 → 会话/token 状态只能靠猜"的跨文件两步提交窗口：让 transcript 携带每次发言的提交元数据，topic.json 的 participant 派生字段（sessionRef/tokens/failures）可由 transcript 重放重建。

## Schema

### transcript 事件扩展（向后兼容，可选字段）

```ts
interface SpeechCommit {
  sessionRef: SessionRef | null;          // 该次发言后的会话引用(null = 会话已作废)
  tokens: { input: number; cached: number; output: number }; // 该参与者发言后的累计值
}
// TranscriptEvent 增加:
commit?: SpeechCommit;
```

- **message / skip**：speak 成功 → `commit = { sessionRef: result.sessionRef, tokens: 累计 }`。
- **error（from=参与者）**：speak 失败 → `commit = { sessionRef: null, tokens: 累计(不变) }`，表示该参与者会话作废（与 runner 的 clearSession 语义一致）。
- verdict / system / human / round_end：无 commit（裁决人/插话不并入参与者状态）。
- 旧事件无 commit → 读取兼容，重建时视为"不可验证，保留 checkpoint 值"。

### failures 重建

`participants[].failures` = 该 handle 的 `error` 事件数（runner 每次 speak 失败恰好 append 一条 error 并 bumpFailures，计数一致）。

## 重建与对账（runner 启动时）

纯函数（导出供单测）：

```ts
rebuildFromTranscript(events, handle): SpeechState | null
// 按 seq 序扫描 from===handle 且带 commit 的事件,取最后一个 commit;failures = error 事件数。
// 无任何带 commit 的事件 → null(旧数据,不覆盖 checkpoint)。
```

`runTopic` 开头（loadTopic 后）：

1. `rebuilt = rebuildFromTranscript(readTranscript(dir), handle)` per participant。
2. rebuilt 为 null → 保留 topic 现值（旧数据，无 commit 可验证）。
3. 与 topic 现值不一致 → 覆盖 participant 的 sessionRef/tokens/failures，并 `saveTopic` 一次。
4. 进度字段（currentRound / resumeFromSeq / finalization / status / outcome）不追溯，保持 checkpoint 语义。

## 关键路径推演

| 崩溃点 | transcript 状态 | 对账结果 |
|---|---|---|
| appendEvent(message) 后、saveTopic 前 | 有 commit | 覆盖 → sessionRef/tokens 与 transcript 一致 |
| appendEvent(error) 后、clearSession 前 | error 有 commit(sessionRef:null) | 会话作废 + failures+1 → 下轮全量新会话 |
| finalize 更新 summarizer 后、summary-written 前 | 无新 commit | 不动（summarizer 最终 ref 不追溯；topic 现值保留） |
| 旧数据（无 commit） | 无 commit | 保留 checkpoint（既有降级语义不变） |

## 实现步骤

1. `store/transcript.ts`：`SpeechCommit` 类型 + `TranscriptEvent.commit?`。
2. `engine/runner.ts`：
   - `rebuildFromTranscript(events, handle)` 纯函数（导出）。
   - `runTopic` 开头对账 + 变更时 saveTopic。
   - `speakOnce`：message/skip/error 事件携带 commit。
3. `test/`：重建纯函数单测 + e2e（篡改 topic.json 模拟崩溃现场 → continue 后对账恢复）。
4. spec：`roundtable-engine-invariants.md` 补"不变量 7：transcript commit 对账"。

## 约束

- 不引入 DB/WAL；transcript 仍单写者 append-only，seq 严格递增（既有不变量不动）。
- commit 是累计值（非增量）：最后一条胜出，避免求和错误。
- 不做版本号迁移：字段可选即兼容。

## 权衡

- 每次 runTopic 开头多一次 transcript 全量扫描（本地 CLI 事件量小，可忽略）。
- summarizer 最终 ref 不在 transcript 中：完成态 topic 不会被对账回退（completed 时 runTopic 直接返回）。
