# idle-card

放置卡牌(咸鱼之王同类)的纯 Web 实现。**实验性原型**,住在 `lab/`,可丢弃。

## 是什么 / 什么状态

一个验证性的垂直切片:用 React + TypeScript 证明"前端能做出有打击感、有品质感的放置卡牌核心循环"。

- ✅ 已跑通:战斗内核(事件流 + 单测)、立绘 + 品质边框、Lottie 技能特效、**抽卡 → 编队 → 推图 → 战斗 → 奖励** 完整循环、localStorage 存档、挂机产钻(含离线收益)。
- ⏳ 还差(离"能放着玩"):养成(升级)、数值平衡、真美术。

详见 [`docs/roadmap.md`](docs/roadmap.md)。立项缘起与调研见 [`docs/research-wechat-minigame-2026-06-18.md`](docs/research-wechat-minigame-2026-06-18.md)。

## 运行

```bash
pnpm -F idle-card dev     # 开发
pnpm -F idle-card test    # 单测(5/5)
pnpm -F idle-card build   # 类型检查 + 打包
```

## 架构要点

**逻辑与表现解耦**:`src/battle/engine.ts`(纯函数,不 import React)算完整场战斗,产出 `BattleEvent[]` 事件流;`src/Battle.tsx` 照事件逐个播放(冲锋/飘字/暴击顿帧/技能特效/震屏)。

→ 改数值不动画面,改特效不动逻辑;内核可单测、可移植(以后想搬去微信小游戏不用重写)。

```
src/
├─ battle/{types,engine,engine.test}.ts   事件流契约 + 内核 + 单测
├─ vfx/burst.json                         手写 Lottie 特效
├─ Lottie.tsx / portrait.ts               特效 / 立绘的单一替换点
├─ heroes.ts                              卡池 + 抽卡概率 + 关卡敌人
├─ Battle.tsx                             战斗表现层
└─ App.tsx                                游戏外壳(抽卡/编队/推图)
```
