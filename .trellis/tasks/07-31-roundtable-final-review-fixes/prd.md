# agent-roundtable: 终审六项阻断修复

## Goal

4 模型终审（2026-07-31 收官终审）裁决：当前不可收官，锁定六项发布阻断，全部先红后绿回归钉死。

## 阻断集

1. **全员/含 error 不得收敛**：`stanceMap` 将 error 与 skip 同档导致全员失败被冒充"已收敛"。修复：error 不产生 stance；本轮任一 error → `checkConverged` 不收敛。连带：第 3 次连续失败 A1 熔断 paused 成组锚定。
2. **error/skip 四象限**：纯 skip 可收敛 / 任一 error 不得以"全员跳过"收尾 / error+skip 混合不得收尾 / 混合下熔断仍按连续 error 计数。
3. **证据门槛**：零引用 `verifyEvidence().ok===false`；至少一条指向参与者 `message` 的引用（verdict/skip 不能单独背书）。
4. **引擎侧 hash+generation 绑定**：finalize 后引擎写 `summaryEvidence:{transcriptHash,generation}` 结构化元数据（summary 是模型产物，不自报凭证）；`verify` 默认读元数据，旧话题无绑定返回"不可验证"。
5. **按模式动态收尾预算**：默认 `max-calls = 参与者×轮数 + 收尾调用数(roundtable 1 / debate 2) + 余量 2`；显式 `--max-calls` 优先。
6. **README detach/v2 叙述矛盾**修正 + 文本断言。

## Acceptance Criteria

- [ ] ① ② 四象限 + 熔断成组测试全绿。
- [ ] ③ 零引用/仅 verdict-skip 引用 → ok=false；含 message → ok=true。
- [ ] ④ 篡改 transcript 默认 verify 失败；旧话题无绑定 → "不可验证"。
- [ ] ⑤ 未传参默认预算按公式落盘；debate 收尾计数为 2。
- [ ] ⑥ README 矛盾消除 + 断言。
- [ ] 全量测试通过，无回归。
