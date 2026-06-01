---
name: novel-setting
description: Build a reusable power system and worldview for a novel using a stable schema (tiered power ladder with quantified abilities, worldview base, geography/factions) plus per-world instances, then sanity-check it (ladder is countable, abilities are quantified, leveling driver agrees with the style contract's pacing and the protagonist's cheat). Use when designing a cultivation/power system, worldbuilding, or checking a power ladder for consistency.
---

# 小说设定 / 力量体系（Novel Setting & Power System）

把"世界长什么样"落成可复用、可检验的设定契约，核心是**力量体系**（网文命脉）。属于**开工准备包第 ② 层**（全景见 `docs/notes/2026-06-01-小说开工准备包全景.md`）。

**核心设计：框架与世界分离。** `template.md` 的 schema 稳定；每本书填一份命名实例（`docs/settings/<体系名>.md`）。

**语言：** 跟随用户，默认中文。

## 两种模式

| 模式 | 干什么 | 触发 |
|---|---|---|
| **建体系**（默认） | 产出/修订一份设定契约实例 | "设计力量体系""搭世界观" |
| **校验**（可选） | 检查台阶/能力/接口是否过关 | "查查体系有没有问题" |

---

## 模式一 · 建体系

### Phase 1：世界观底座
读 `template.md`。先定 §1：力量本源（靠什么变强）、世界规则、时代背景。
- **接口提醒**：世界"是不是弱肉强食"在这定（客观规则）；它读起来"多冷"在风格契约维度 F 定。别两处都定义。

### Phase 2：力量体系台阶（核心，花最多力气）
填 §2.1 台阶表，逐阶给**可量化能力**——不是"更强了"，而是"能御空 / 能移山 / 能操控法则"。
- 台阶数控制在**经典 5-9 阶**：太少撑不起百万字，太多读者记不住。
- 每个大境界是否再分小层（如炼气 1-13 层）在 §2.2 定。

### Phase 3：晋级驱动 — 三方接口自洽（最关键的校验）
填 §2.2"晋级驱动"时，必须和另外两块对齐：
- **↔ 风格维度 C（升级速度）**：资源积累+熬瓶颈 → 慢；战斗历练+机缘白给 → 快。
- **↔ ① 金手指 / ③ 主角**：金手指若是"催熟资源"，体系就该"资源驱动"。
- 三者矛盾就停下让用户调，别硬写一个"体系慢、气质快"的别扭组合。
- 对齐范例：`examples/fanren.md` §2.3（资源驱动·慢 ↔ fanren 风格 C ↔ 韩立资源型金手指）。

### Phase 4：地理势力 + 设定物
- §3 势力表的"实力层级"统一用 §2 台阶做尺。
- §4 关键设定物：定义金手指**所处的设定环境**，不重新定义金手指本身（那是 ① 创意层）。

### Phase 5：存盘
复制 `template.md` 结构填好，写入 `docs/settings/<slug>.md`（目录不存在则创建），删模板提示块。
参考实例：`examples/fanren.md`。

---

## 模式二 · 校验（可选）

读设定实例 + 该书风格契约 + 主角卡，逐项体检：

1. **台阶可数**：读者数得清吗？（5-9 阶）
2. **能力量化**：每阶都有具体能力跃迁，还是含糊"变强"？
3. **晋级驱动三方自洽**：体系驱动 ↔ 风格升级速度 ↔ 主角金手指 一致吗？
4. **同一把尺**：势力实力层级是否都用力量台阶标注？
5. **金手指咬合**：金手指是"长在世界规则里"还是凭空挂载？

输出：问题清单 + 定位到哪一节 + 修补方向（不直接代写）。辅助信号，需人工拍板。

---

## 文件与边界

| 文件 | 作用 |
|---|---|
| `template.md` | 设定框架·稳定 schema（不改字段轴） |
| `examples/fanren.md` | 经典修仙九境实例，与 fanren 风格 + hanli 金手指对齐 |
| `docs/settings/<slug>.md` | 用户产出的设定实例（每个世界一份） |

**关键边界**（来自全景"重叠与边界"表）：
- **② 定义 / ⑥ 登记 / ④ 调度**：本契约定义台阶；⑥ 名词表登记正文已用专有名词；④ 大纲调度何时突破。一处定义、一处登记、一处调度。
- **② 世界规则 / ⑤ 世界温度**：客观规则在这；阅读冷暖感觉在风格契约维度 F。

## 链路
- **上游**：① 金手指（决定晋级驱动取向）。
- **平行对齐**：⑤ 风格维度 C/F、③ 主角金手指。
- **下游**：④ 大纲用台阶排突破节奏；⑥ 状态表记主角当前境界；设定随风格前缀作为上下文喂章节生成。
