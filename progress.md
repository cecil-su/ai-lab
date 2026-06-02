# 进度日志

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
