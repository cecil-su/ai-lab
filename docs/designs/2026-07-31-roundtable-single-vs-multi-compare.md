# agent-roundtable 对比:单模型 vs 4 模型对抗(2026-07-31)

## 背景与方法

同一评审任务(codex-skill-board 实现路径评审)、同一注入材料(IMPLEMENTATION_PLAN.md + server/db.ts + server/index.ts + package.json,102.4 KB):

- **4 模型对抗**:claude/codex/opencode/reasonix × 2 轮 debate + claude 裁决轮(话题 `2026-07-31-codex-skill-board-实现路径评审`)
- **单模型**:4 家各自新会话单轮回答(`scripts/compare-single-models.ts`,统一问题模板)

## 数据

| 维度 | claude | codex | opencode | reasonix | 4 模型 debate(合计) |
|---|---|---|---|---|---|
| 发现命中(6 项) | 6/6 | 6/6 | 0/6* | 6/6 | 6/6 + 交叉验证 |
| input token | 48.5k | 32.3k(cached 11k) | 0(报告异常) | 90.5k | ~191k(2 轮 + 裁决) |
| output | 6.1k | 3.2k | 0.5k | 20.3k | ~10k |
| 耗时 | 103s | 68s | 31s | 176s | ~15min |

\* opencode 输出 59 字符("评审任务仍在运行,待完成后统一输出")——**长任务输出被截断**,是 opencode adapter 的真实缺陷信号(长 prompt 下把中间状态当最终结果),需单独排查。

## 命中矩阵(对照 debate 的 6 项发现)

| 发现 | claude | codex | reasonix |
|---|---|---|---|
| verified-scan 违反只读红线 | ✓ | ✓ | ✓ |
| 伪流式/Running 未先落库 | ✓ | ✓ | ✓ |
| 读取边界(.env/密钥) | ✓ | ✓ | ✓ |
| 零测试设施 | ✓ | ✓ | ✓ |
| 硬编码内网 IP | ✓ | ✓ | ✓ |
| 半删函数(mock 仍引用) | ✓ | ✓ | ✓ |

## 结论

1. **单模型评审质量不差**:claude/codex/reasonix 单轮即可命中全部 6 项主要发现,且排序与深度合理。单模型是"便宜快速扫描"的有效形态(平均 ~43k input/家,1-3 分钟)。
2. **4 模型对抗的增量价值**:
   - **交叉纠错**:历史中 claude 在 debate 里承认"已相当扎实"的判断被 reasonix 证伪;单模型断言无此对抗校验。
   - **收敛裁决**:冲突观点(如"采纳率门禁 vs 测试基线优先")由裁决人排序,产出可执行的行动清单;单模型输出是"意见"而非"决议"。
   - **置信度**:四方一致 + 裁决背书的问题,比单模型断言更可信(对高风险决策尤为重要)。
3. **成本对比**:debate 2 轮 ≈ 191k input ≈ 4.4 个单模型轮;但产出多一轮反驳与一份裁决。1 个单模型轮(≈43k)是 debate 的 ~23%。
4. **opencode 截断**是本次对比的独立发现:单模型形态暴露了 adapter 长任务缺陷(4 模型 debate 中 opencode 表现正常——轮次内任务较短未触发)。

## 最佳实践建议

```
低风险/快速扫描    → 单模型 1 轮(claude 或 codex,~43k,1-3 分钟)
高风险决策/行动清单 → 4 模型 debate 2 轮(~191k,15 分钟,裁决排序)
批量扫描          → 单模型并行(4 家并行 ≈ 单家耗时,总 token 4×)
```

配套:单模型形态配合预算护栏(--max-calls)与 verify(证据链)同样适用。
