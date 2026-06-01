# 任务计划：小说创作框架 — 落实运行时层（S/A/B 改进）

## 目标

把"design-time 重、runtime 空"的诊断转成落地物：给六层准备包补上**运行时控制层**。
用户决策：**跳过 M0**，先把引擎建好，后续在真实连载里验证（实战 = 市场验证）。

成功判据：
- 运行时 tick 循环、上下文装配、伏笔台账、语言指纹四件套各有可用落地物。
- 语言指纹脚本能**自动复现**劣化测试里手工发现的"章末趋同 + 高频词堆积"（硬验证）。
- 新层与既有六层接口不打架（边界表自洽）。

## 改进项 → 落地物映射

| 项 | 落地物 | 状态 |
|---|---|---|
| S1 tick 循环 | `skills/novel-runtime/SKILL.md`（编排§阶段三升级为控制环） | [x] |
| S2 每章上下文装配 | 同上"装配"一节 + template 装配单 | [x] |
| A3 语言指纹 daemon | `lab/novel-fingerprint/`（真代码 + 3章fixture，**跑通报 WARN，复现手工发现**） | [x] |
| A4 审计=只验 conformance | `novel-style/SKILL.md` 模式三加 banner | [x] |
| A5 剪死维度 | 已跑测量（n=1）：7 维全绑定**一个不删**；真发现=A/G/禁忌"剧透"三重冗余（合并待确认）。见 findings F5 | [x] |
| B6 伏笔台账 | `novel-consistency` 表 C（人工驱动 + 到期提醒）全套 | [x] |
| B7 仪表盘（5 图） | `novel-runtime` 看板一节 + template/example 快照 | [x] |
| B8 50–100 章尺度验证 | 用户定"实战验证" → 记入挂起，不空造文档 | [ ] 挂起 |
| B9 读者信号输入口 | `novel-runtime` 读者口一节 + template 一格（留空口） | [x] |

## 当前阶段
**全部完成**（B8 + A5实测 按用户意愿挂起到实战）

## 各阶段

### 阶段 1：语言指纹脚本 + 硬验证 — complete
- [x] `lab/novel-fingerprint/fingerprint.mjs` + README + fixtures
- [x] 跑通报 WARN，自动复现"慢慢来"章末口头禅 + 不划算/来历不明 措辞 tic

### 阶段 2：novel-runtime 新 skill — complete
- [x] SKILL.md / template.md / examples/fanren.md

### 阶段 3：改 style（A4+A5）与 consistency（B6） — complete
- [x] novel-style：审计 conformance banner + 维度绑定审计法 + 动态反重复指引
- [x] novel-consistency：表 C 伏笔台账（template/SKILL/example）

### 阶段 4：同步文档 — complete
- [x] 全景"当前状态" + progress + findings + task_plan + memory

## 已做决策

| 决策 | 理由 |
|------|------|
| 跳过 M0 直接建 runtime | 用户明确选择，后续实战验证 |
| runtime 单独成 skill 而非改编排文档 | 它是第 7 个正交关注点（"边写边维护"），享 skill 框架/实例同等地位 |
| 语言指纹用真代码不写进 prompt | 纯确定性计算，是 daemon 不是判断；唯一"码胜过提示词"处 |
| A5 不真删维度 | 弱证据删框架=破坏性；先给测量法，删除待实测 |
| 伏笔台账人工驱动 | "是不是伏笔"是作者意图，文本测不出；LLM 只做到期提醒 |
