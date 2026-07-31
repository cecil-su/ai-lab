# agent-roundtable: 证据化 summary — 结论链接 transcript seq (Phase-3 ④)

## Goal

让 summary.md 从"各方立场摘要"进化为**可追溯结论**：每条结论/裁决/分歧可链接到 transcript 原始发言（seq），坏行降级时显式标注可信度。评审来源：4 模型裁决"结论必须能解析到有效 seq；日志坏行时明确降级可信度"。

## Requirements

1. **证据索引段**：两个模式 finalize 写 summary 时追加 `## 证据索引`，逐条列出 `[seq N] R<round> <from>: <正文摘要>`（message/skip/verdict；摘要截断 ~80 字）。
2. **坏行降级**：transcript 存在损坏行（崩溃残留/字节交错）时，索引尾部标注 `⚠ 日志存在 N 行损坏，证据索引可能不完整`；`readTranscript` 语义不变（容错跳过已有），新增 detailed 读取暴露 badLines。
3. **结论可解析**：索引内 seq 必须能解析到实际事件（生成时从事件列表构造，天然保证）。
4. **兼容**：旧 summary 无索引段不受影响；新 summary 在每次收尾（含兜底失败 summary）之外仅正式收尾追加索引（兜底 summary 不加——它无正式结论）。

## Acceptance Criteria

- [ ] roundtable/debate 正式 summary 含证据索引，格式 `[seq N]`，seq 均存在于 transcript。
- [ ] 坏行 > 0 时索引尾部有降级标注（单测：预置坏行 → finalize → summary 含标注）。
- [ ] 兜底 summary（finalize 失败）不含证据索引。
- [ ] 全量测试通过，无回归。

## Notes

- 证据索引是展示层增强，不改 transcript schema（seq 已存在）。
- 正文摘要复用 truncateBody 逻辑（prompt.ts 已有）。
