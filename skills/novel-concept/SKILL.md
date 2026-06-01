---
name: novel-concept
description: Pin down a novel's core concept — logline plus the 金手指 (cheat/mechanism) and its strength curve — using a stable schema plus per-work instances, then align it downstream (protagonist personality, power system, style pacing). Use when defining a story premise, choosing or tuning a 金手指, or checking that the cheat's strength curve is sound. This is the foundation layer; the cheat drives everything else.
---

# 小说核心创意（Logline & 金手指）

把"靠什么爽"落成可检验的创意契约。属于**开工准备包第 ① 层 · 地基**——金手指定错，全书爽点节奏跟着错，推倒重来。所以**最先定**（全景见 `docs/notes/2026-06-01-小说开工准备包全景.md`）。

**核心设计：框架与创意分离。** `template.md` schema 稳定；每本书填一份命名实例（`docs/concepts/<作品名>.md`）。

**语言：** 跟随用户，默认中文。

## 两种模式

| 模式 | 干什么 | 触发 |
|---|---|---|
| **定义**（默认） | 产出/修订一份创意契约 | "想个点子""定金手指""写 logline" |
| **校验**（可选） | 查强度曲线 + 龙头接口 | "这个金手指能撑住吗" |

---

## 模式一 · 定义

### Phase 1：Logline
逼出一句话：**主角是谁 + 金手指是什么 + 主线冲突是什么**。写不清就继续逼，写不清=没想清。

### Phase 2：题材 × 机制（正交）
- §2 题材（写什么，定背景）+ §3 机制（靠什么爽，定爽点来源）。
- 强调两者正交：题材定背景、机制定爽点，组合才成具体设定。

### Phase 3：强度曲线（最容易翻车，重点）
填 §4：
- 强度定位瞄准**适中**——太强中后期没张力，太弱读者弃书。
- 必须给**成长性**或**代价**（最好都有），堵掉"白给的无限金手指"。
- 自检两问：开局 1000-2000 字能靠它造钩子吗？中后期还有张力吗？

### Phase 4：龙头接口对齐
填 §5，逐项确认金手指牵动的四块一致：
- → ③ 主角性格（资源型配务实、无敌型配张扬）
- → ② 设定（金手指打破哪个瓶颈，长在体系里）
- → ⑤ 风格维度 C（白给→快、需积累→慢）
- → ④ 结构爽点节奏
- 对齐范例：`examples/fanren.md` §5。

### Phase 5：存盘
复制 `template.md` 结构填好，写入 `docs/concepts/<slug>.md`（目录不存在则创建），删模板提示块。

---

## 模式二 · 校验（可选）

读创意契约 + 已有的 ②③⑤ 实例，逐项体检：

1. **Logline 三要素**齐不齐（主角/金手指/冲突）？
2. **强度曲线**：是否落在"适中"？有成长性或代价吗？会不会早早封顶？
3. **开局钩子**：金手指能在开篇造钩子吗？
4. **龙头四接口**：主角性格 / 设定瓶颈 / 风格升级速度 / 结构节奏，四处与金手指自洽吗？

输出：问题清单 + 定位 + 修补方向。辅助信号，需人工拍板。

---

## 文件与边界

| 文件 | 作用 |
|---|---|
| `template.md` | 创意框架·稳定 schema |
| `examples/fanren.md` | 小瓶金手指实例，作为 fanren 家族龙头 |
| `docs/concepts/<slug>.md` | 用户产出的创意契约（每本书一份） |

**关键边界**：① 定义金手指"是什么+多强"；② 定义它所处设定环境；③ 定义它配什么主角性格与爽点。三处各管一段。

## 链路
- **地基**：① 最先定，是 ②③④⑤ 的共同上游。
- **下游**：金手指牵动主角(③)、设定瓶颈(②)、升级速度(⑤C)、爽点节奏(④)。
