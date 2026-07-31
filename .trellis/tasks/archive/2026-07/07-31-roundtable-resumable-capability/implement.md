# Implement — capabilities 补 resumableSession 并持久化 (Phase-3 ②)

## 已完成

- [x] `ProviderAdapter.capabilities.resumableSession?: boolean` 声明：claude/codex/opencode=true；reasonix/mock=缺省 false。
- [x] registry 真值表兜底：`isResumableProvider(base)` + `adapterResumable(spec, resolve)`（声明优先，注入 resolver 可覆盖）。
- [x] `topic.capabilities: Record<handle, { resumableSession }>`：createTopic 创建即落快照（显式声明优先，缺省真值表）；loadTopic 对旧 topic 按真值表推导。
- [x] cmdNew 用 adapter 声明填充快照；listView 按 participant 投影 `resumableSession`（list --json 可消费）。
- [x] 测试：capabilities.test.ts（声明/真值表/注入覆盖）、topic.test.ts（持久化+旧格式推导）、commands.test.ts（listView 投影）。

## 验证

- [x] `pnpm -F agent-roundtable typecheck`
- [x] `pnpm -F agent-roundtable build`
- [x] `pnpm -F agent-roundtable test` — 147 passed / 3 skipped
- [x] `git diff --check`

## Notes

- 行为无破坏性变化：本次仅显式化并持久化已有隐式语义；真正的恢复决策消费点在 Phase-3 ①（transcript 恢复源）落地时接入。
- list --json 新增 `participants[].resumableSession` 字段（向后兼容的增量字段）。
