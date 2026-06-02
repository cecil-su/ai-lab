---
name: novel-consistency
description: Maintain a novel's consistency ledger — a character current-state table (current cultivation tier, gear, injuries, relationships), a setting/term registry (places, techniques, items, factions already used), and a foreshadowing ledger (planted hooks with their expected payoff window and open/resolved status) — to prevent contradictions, term drift, and dangling setups over a long serialization. LLM extracts change candidates; a human confirms before they enter the ledger (foreshadowing especially is human-judged, LLM only reminds when a payoff is due). Use when setting up consistency tracking, updating it after a chapter, or checking state/terms/open-hooks before writing.
---

# 小说一致性底账（角色状态表 + 设定名词表 + 伏笔台账）

对抗长篇真正的杀手——**作者自己忘了之前写过什么**。属于**开工准备包第 ⑥ 层**（全景见 `docs/notes/2026-06-01-小说开工准备包全景.md`）。

与别的层不同：这不是开工前一次性设计的契约，而是**边写边维护的底账**，记"当前实际值"。开工时建空表，每章写后增量更新。

**铁律（来自研究文档 §五方向C / §1.9）**：LLM 抽实体变更准确率只有 70-80%，错一次污染全表。**只用 LLM 抽候选，人工确认才入库。** 不做完整一致性引擎。

**语言：** 跟随用户，默认中文。

## 三种模式

| 模式 | 干什么 | 触发 |
|---|---|---|
| **建空表**（开工时） | 按 ②③ 填初始状态 | "建一致性表""初始化底账" |
| **更新**（每章写后） | 抽变更候选（状态/名词/伏笔）→ 人工确认入库 | "更新状态""这章写完了" |
| **查表**（写新章前） | 查当前境界/已用名词/到期伏笔 | "韩立现在什么境界""这名字用过没""哪些伏笔该回收了" |

---

## 模式一 · 建空表（开工时）

读 `template.md` 拿三张表 schema。按当前已有信息初始化：
- 表 A：从 ③ 角色卡 + ② 起始境界，填主角与重要配角的初始状态。
- 表 B：把 ② 设定里已定、且正文将很快用到的专有名词先登记。
- 表 C：通常开工时为空；若 ④ 大纲已规划了长线伏笔（如金手指来历将在卷三揭晓），可先登记，标好预期回收窗口。
写入 `docs/ledgers/<作品名>.md`。

## 模式二 · 更新（每章写后，核心流程）

1. **抽候选**：从新章正文抽三类候选——①状态变更（谁的境界/装备/伤势/关系变了）②新出现的专有名词 ③伏笔（本章埋了什么疑似钩子 / 回收了表 C 哪条）。
2. **人工确认**：逐条交用户核对。**确认无误才**改表 A / 追加表 B / 登记表 C。LLM 抽错不许自动入库。**伏笔尤其靠人工判**——LLM 说"疑似伏笔"，但"是不是真伏笔"是作者意图，作者决定立不立账。
3. 标注「最后更新章」。

> 演示见 `examples/fanren.md` 维护流程（韩立炼气→筑基那章的抽取-确认-更新）。

## 模式三 · 查表（写新章前）

开写下一章前：
- 查表 A：主角/相关配角的**当前境界、伤势、关系**，避免写崩（如误把筑基写回炼气）。
- 查表 B：要用的专有名词**之前怎么写的**，避免名词漂移（同物两名 / 同名两物）。
- 查表 C：哪些伏笔**到了回收窗口**该还了，避免悬空的钩子被读者追着问。

---

## 文件与边界

| 文件 | 作用 |
|---|---|
| `template.md` | 三张表框架·稳定 schema |
| `examples/fanren.md` | 凡人式卷一末快照 + 维护流程演示 |
| `docs/ledgers/<slug>.md` | 用户的一致性底账（每本书一份，持续增长） |

**关键边界**（来自全景"重叠与边界"表）：
- ② **定义**力量台阶；④ **调度**何时突破；③ 记**稳定人设**；⑥ 表 A 记**会变的当前实际值**（当前境界/装备/伤势）。四处各管一段。
- **不做**：知识图谱、**自动伏笔回收判定**（表 C 只人工登记 + 到期提醒）、语义级合规评分。只维护这三张表。

## 链路
- **上游**：② 台阶（境界尺）、③ 角色卡（初始状态）、④ 大纲（长线伏笔的回收窗口）。
- **写作回路**：查表 → 写章 → 抽候选 → 人工确认 → 更新表 → 查表写下一章。这套每章循环由 `novel-runtime` 编排（本层提供三个 store，runtime 提供 tick）。
