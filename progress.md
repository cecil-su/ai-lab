# 进度日志

## 会话：2026-06-02（三梯队推进 · 每章质量闸 + 消融/结构指纹路线图）

设计讨论结论："系统全在测别漂移（负向），缺 outcome 信号"。定下三梯队（原则：先有尺子再添功能；最巧妙≠最该先做），用户拍板"按三梯队推进"。

### 梯队一 · 每章质量闸 — 建（complete）
- `novel-style/SKILL.md`：三种模式→四种；模式三更名"审计·合规"；新增**模式四·审计·猎缺陷**（失败模式清单 7 类 + 对抗 skeptic prompt 模板 + 边界）。核心立论：质量测不了、但"弃书的具体硬伤"可枚举有原句；证伪比证好可靠，挡住自评偏高；不打分、不模拟读者。
- `novel-runtime/SKILL.md`：tick 第 2 步重构为**每章质量闸**（验收单 + 合规 + 猎缺陷，任一未过→改写 pass）；装配加**本章验收单**（TDD 化：先立单再写章，从 ④关键节拍+⑥到期伏笔派生）；新增《每章质量闸》小节（三检查极性表 + "唯一逐章 outcome 信号" + "消融标尺"）。
- `novel-runtime/template.md`：装配单加验收单行 + 新增 2.5 质量闸结果表 + 维护流程第 2 步同步。
- `novel-runtime/examples/fanren.md`：补第 2 步质量闸演示（第 3 章：欠张老头线 / F 偏暖 / 情绪外露"又惊又怕"→三处进改写 pass）。

### 梯队二 · 框架消融 — 协议就绪（待真连载启动）
- `docs/notes/2026-06-02-生成期质量闸-路线图.md`：全装配 vs 瘦基线，~20 章随机分臂，用梯队一质量闸盲评 + 人工盲读偏好；决策规则"无可测差异的层=仪式"。把 B8 从尺度验证升级为反事实验证。前置（标尺）已就位。

### 梯队三 · 结构指纹引擎 — 设计稿带门槛（暂不建）
- 同上路线图：套路疲劳（结构同质）现有词层指纹看不见；设计=每章抽结构向量、LLM 打标+计算比对（混合非纯 daemon）、太像→开"该换什么"处方（激活看板第 2 图）。**门槛：过 ~20 章 且 消融证明结构影响 outcome 再建**——现在写违背"先有尺子"。

### 暂缓
- 情境金句库（F6 已证上一章当锚够用，边际最低）。

## 会话：2026-06-02（review 补强 · 固化 F6/F7 + 指纹 fixture + 编排同步）

承上轮 review：体系框架已完整，唯一缺口是"已验证技法只活在 findings、没进 skill"。用户选定补 ①②③（不做 ④ novel-stylecheck）。

### ① 固化样例锚 + 改写 pass（F6/F7 → skill）— complete
- `novel-style/SKILL.md` 模式二加「样例锚」节：抽象前缀是方向、钉不住词/句级（F6 实测 ch1 不达标），补 1-2 段样板正文让模型模仿具体文本；ch1 用参照作品片段，定稿后自举成 ch2+ 的锚。
- `novel-runtime/SKILL.md`：tick 第 2 步"跑味回 1"→「改写 pass」（消费审计清单、情节零改动、不重 roll，F7）；装配配方加「样例锚」块。与第 3 步指纹的"改写最新章"统一了（原本第 2 步重 roll、第 3 步改写，自相矛盾）。

### ② 指纹合成 fixture（开箱即跑 + 回归锚）— complete
- `fixtures/` 原只有 names.txt，三章正文带版权未提交 → README"硬验证"在仓库内复现不了（实跑 ENOENT）。
- 补 3 章**合成**正文（原创无版权，埋 `不动声色`/`压不下去` 两 tic）。实跑：退出码 2（WARN），信号一 surface `不动声色/压不下去`、信号二b surface 章末 `压不下去`。更新 README"验证"节，记录预期输出当回归锚。

### ③ 同步编排文档 — complete
- `2026-06-01-创作流程编排.md`：标题"六 skill"→"六准备包 + 运行时"；阶段三循环对齐 runtime tick（加样例锚 / 指纹 daemon 步 / 改写 pass，"回 3"改掉）；加回指 novel-runtime 的交叉链接。

### 未做（沿用上轮挂起）
- ④ novel-stylecheck（章内句长/对话占比 lint，F6 候选①）—— 用户本轮未选。
- A5 多样本盲评、B8 尺度验证 —— 留待实战。

## 会话：2026-06-01（小说运行时层 · 落实 S/A/B）

### 背景
六层准备包诊断为"design-time 重、runtime 空"。用户决策跳过 M0，先建运行时引擎，留待实战验证。

### 阶段 1：语言指纹 daemon + 硬验证 — complete
- 新建 `lab/novel-fingerprint/fingerprint.mjs`（零依赖纯计算）+ `README.md` + `fixtures/`（劣化测试 3 章正文 + 名词表）。
- 迭代两轮修正：①信号一被人名噪声淹没 → 加 `--names`（喂 ⑥ 表B 滤专名）；②信号二字面余弦漏报主题趋同 → 加"章末重复短语"信号 + 诚实标注主题层交 ⑤ 审计。
- **硬验证通过**：跑 3 章 fixture 报 WARN，信号二b 自动 surface 出"慢慢来"章末口头禅、信号一 surface "不划算/来历不明"——复现了当初手工发现的漂移。

### 阶段 2：novel-runtime 新 skill — complete
- `skills/novel-runtime/`：SKILL.md（四 store 注册表 + tick 循环 + 上下文装配 + 5 图看板 + 读者口）+ template.md（运行时状态文件框架）+ examples/fanren.md（一次 tick 演示，含真跑指纹）。

### 阶段 3：改 style + consistency — complete
- `novel-style/SKILL.md`：审计降级为 conformance-only（A4）；加"维度绑定审计法"（A5，未实测不删）；注入要点加动态反重复指引（指向 runtime）。
- `novel-consistency/`：template+SKILL+example 全加**表 C 伏笔台账**（B6，人工驱动 + 到期提醒），边界由"不做自动伏笔回收"细化为"只登记+提醒，不做自动回收判定"。

### 阶段 4：同步文档 — complete
- 全景文档"当前状态"加"补建：运行时层"小节；progress/findings 追加；task_plan 覆盖式重写；memory 更新。

### 挂起（未做，诚实记录）
- A5 维度绑定**实测**（只给了方法，没跑）。
- B8 50–100 章尺度验证（用户已定为"实战验证"）。
- M0 两步（实测阅文助手、用户访谈）——用户本轮明确跳过。

## 会话：2026-04-08

### 阶段 1：分析现有文档和提交记录
- **状态：** complete
- 执行的操作：
  - 查看全部 5 次提交记录和 diff 统计
  - 盘点 docs/ 下已有文档（monorepo-scaffold 和 knowledge-feed 各有设计+计划）
  - 确认缺口：news-curator 无设计文档和实现计划，根 README 未列出项目

### 阶段 2-3：创建 news-curator 设计文档和实现计划
- **状态：** complete
- 创建/修改的文件：
  - docs/designs/2026-04-08-news-curator.md
  - docs/plans/2026-04-08-news-curator.md

### 阶段 4：更新根 README.md
- **状态：** complete
- 创建/修改的文件：
  - README.md（添加 Projects 表格）

## 五问重启检查
| 问题 | 答案 |
|------|------|
| 我在哪里？ | 全部完成 |
| 我要去哪里？ | 无剩余阶段 |
| 目标是什么？ | 为 news-curator 补文档，更新根 README |
| 我学到了什么？ | 见 findings.md |
| 我做了什么？ | 创建 3 个文件，修改 1 个文件 |
