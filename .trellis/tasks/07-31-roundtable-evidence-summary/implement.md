# Implement — 证据化 summary (Phase-3 ④)

## 已完成

- [x] `readTranscriptDetailed` 暴露 badLines（readTranscript 包装复用，语义不变）。
- [x] `evidenceIndex(events, badLines)`：正式 summary 追加 `## 证据索引`，逐条 `[seq N] R<round> <from>: <摘要 80 字>`（message/skip/verdict）。
- [x] roundtable/debate 两处 finalize（含 debate 崩溃幂等重建分支）接入索引；坏行 >0 时标注"证据索引可能不完整"。
- [x] 兜底 summary（finalize 失败 / 无 runner stop）不含索引（无正式结论）。

## 验证

- [x] `pnpm -F agent-roundtable typecheck`
- [x] `pnpm -F agent-roundtable build`
- [x] `pnpm -F agent-roundtable test` — 170 passed / 3 skipped（21 files）
- [x] `git diff --check`

## 测试

- 索引 seq 全部可解析到 transcript 事件（逐条校验）；
- 坏行预置 → summary 含降级标注；
- 兜底 summary 无索引。
