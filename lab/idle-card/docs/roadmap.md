# idle-card 进度与规划

> 放置卡牌(咸鱼之王同类)的纯 Web 实现。
> 立项缘起见 `research-wechat-minigame-2026-06-18.md`。
> 状态:**实验性原型(垂直切片已验证),待在 `lab/`,未毕业。**

---

## 当前状态

已验证的命题:**前端用纯 Web 能做出有打击感、有品质感的放置卡牌核心循环。** ✅

成熟度定位:

```
概念验证/垂直切片  ←【现在在这】
      │
   MVP(能放着玩)        ← 还差:存档 / 挂机 / 养成 / 数值平衡
      │
  可上线产品            ← 远
```

> 外壳是实验,内核(`battle/engine.ts` 事件流架构 + 测试)是可复用资产——即便项目被丢弃,这部分不白费。

---

## 进度日志

### 2026-06-18 · 立项 + 战斗切片 + MVP 循环

**调研 → 决策**(详见 research 笔记):微信小游戏换皮是真实灰产但平台禁止 → 咸鱼之王类是最难换皮的放置卡牌 → 转向自己用纯 Web 实现 → 目标"能玩的成品"。

**已完成(全部经浏览器/测试验证):**

| 模块 | 内容 | 验证 |
|---|---|---|
| P0 脚手架 | Vite + React 19 + TS,接入 `tsconfig.base.json`,`lab/*` 私有 | dev/build 通过 |
| P1 战斗内核 | 纯函数 `simulate`,注入 `rng` 可测;回合制 + 普攻 + 满能量 AoE 大招;产出 `BattleEvent[]` 事件流 | **vitest 5/5**:暴击翻倍 / 残血集火 / 满能量 AoE / 伤害下限 / 胜负判定 |
| 表现层 | `Battle.tsx` 消费事件流:冲锋、飘字、暴击顿帧、震屏、阵亡变灰、战斗日志 | 浏览器实测 |
| 立绘 | `portrait.ts` 生成 SVG 立绘(渐变 + 书法体姓名字),R/SR/SSR 品质边框 | 浏览器实测 |
| Lottie 特效 | 手写 `vfx/burst.json`(闪光 + 冲击波),放技能时叠到目标 | DOM 探测:AoE 出 2 个 burst、各 20 个 SVG 节点 |
| P2 核心循环 | 抽卡(扣钻/概率)→ 编队(选 ≤3)→ 推图(敌人随关缩放)→ 战斗 → 胜利奖励钻石 + 关卡递增 | 全链路实测:胜利后 💎+50、关卡 1→2 |

**架构原则(已落地):** 逻辑与表现解耦——`engine.ts` 不 import React,`Battle.tsx` 不算伤害。改数值不动画面,改特效不动逻辑。

### 2026-06-18 · 存档 + 挂机收益

**已完成(经浏览器/测试验证):**

| 模块 | 内容 | 验证 |
|---|---|---|
| 存档 | `storage.ts`:localStorage 持久化 owned(存 id)/teamIdx/diamonds/stage/lastTs;任一状态变化即写,启动时还原 | 抽卡后 reload,💎 与拥有数从存档还原 |
| 挂机收益 | `economy.ts`:产钻率随关卡线性提升(0.25 钻/秒/关),封顶 8h;每秒刷新结算待领,「领取」入账;按 `lastTs` 支持**离线**收益 | **vitest +4**;reload 后按离线时长结算到 +N💎 |
| 闭环 | 推更高关 → 挂机钻产率更高 → 抽卡变强 → 推更远 | 实测 |
| 辅助 | 「重置存档」按钮(开发自测用) | 实测 |

测试合计 **9/9**(engine 5 + economy 4)。

---

## 待办与规划

### 下一步

1. **养成** — 抽到的卡只能用不能升级,推图很快卡关。先做"升级"一条线(耗钻或新增金币提属性)。养成是当前最大的体验缺口。

### 再往后

4. **数值平衡** — 关卡难度曲线现在是粗拍的,需要成长曲线/品质倍率/关卡难度调参。
5. **真美术** — SVG 占位 → AI 立绘;手写 Lottie → LottieFiles 免费特效。
6. **更多系统** — 装备、技能多样化、PVE 章节、新手引导。

### 砍掉(一期不做)

联网/账号/排行榜/PVP、运营后台、内购支付。

---

## 毕业条件(从 `lab/` 移到 `apps/`)

按仓库约定,毕业 = `mv lab/idle-card apps/idle-card` + 去掉 `package.json` 的 `"private": true`。

触发条件:**存档 + 挂机 + 养成都补上,能连续玩 20 分钟有正反馈(到 MVP)。** 现在远没到,留在 `lab/` 是对的。

---

## 命令

```bash
pnpm -F idle-card dev     # 开发
pnpm -F idle-card test    # 单测
pnpm -F idle-card build   # 类型检查 + 打包
```

## 文件结构

```
lab/idle-card/
├─ docs/
│  ├─ research-wechat-minigame-2026-06-18.md  调研笔记(立项缘起 + 全部链接 + 思路链)
│  └─ roadmap.md                              本文件
├─ src/
│  ├─ battle/{types,engine,engine.test}.ts    事件流契约 + 纯函数内核 + 单测
│  ├─ vfx/burst.json                          手写 Lottie 特效
│  ├─ Lottie.tsx / portrait.ts                特效 / 立绘的单一替换点
│  ├─ heroes.ts                               卡池 + 抽卡概率 + 关卡敌人
│  ├─ economy.ts + economy.test.ts            挂机产钻结算(纯函数 + 单测)
│  ├─ storage.ts                              localStorage 存档读写
│  ├─ Battle.tsx                              战斗表现层
│  └─ App.tsx                                 游戏外壳(抽卡/编队/推图/挂机/存档)
```
