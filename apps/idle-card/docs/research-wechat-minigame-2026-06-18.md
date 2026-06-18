# 调研笔记:微信小游戏「换皮」生态 → 为什么自己做一套放置卡牌

> 日期:2026-06-18
> 缘起:从"微信小游戏感觉都是一套模板换皮,有没有相关资源"出发,一路调研到决定自己用纯 Web 实现一套放置卡牌(即本项目 `idle-card`)。
> 本文保存调研的**结论、资源链接、以及决策思路链**,供日后回溯。

---

## 0. 调研思路链(TL;DR)

```
观察:小游戏同质化/换皮严重,想找资源
  │
  ├─① 换皮是不是真的? → 是,公开灰产 + 平台明令禁止纯换皮 → 个人走"商业换皮"有合规风险
  │
  ├─② 资源在哪? → 分三层:开源 demo(学习) < 引擎模板(Cocos/Laya/Unity) < 商业成品(付费换皮)
  │
  ├─③ 定向三品类(解压/放置/模拟经营)做商品级比价
  │     → 正规成品在 Cocos 商城 ¥3000 档;杂牌在互站/爱给 ¥几百;难度:解压 < 答题/经营 < 放置养成
  │
  ├─④ 用户喜欢"咸鱼之王"这一挂 → 它=放置卡牌 RPG,换皮里最难(数值+联网+后台),个人抄不动
  │
  └─⑤ 转向"自己实现一套" → 目标=能玩的成品;技术栈=纯 Web(React),因为放置卡牌 90% 是 UI+数值,吃前端长处
        → 落到本项目:先做最硬核、最可复用的「战斗内核(事件流)+ 表现层」垂直切片
```

---

## 1. 「换皮」是真实存在的灰色产业(① 验证)

不是错觉,是公开报道的产业链。关键事实:

- 开发者在成熟玩法上叠加热门元素(抖音"解压/治愈"、朋友圈"社交梗")即可收割流量。
- 有报道称 **8 万元打包高仿 10 款**;也有 **2 周开发、成本 10 万、月入数亿**的极端案例。
- 2023 年小游戏开发者从 30 万增至 40 万,新增的 10 万里 8 成是 30 人以下小团队 → 低门槛是同质化的根源。

**但平台明令禁止纯换皮**——《微信小程序平台运营规范》:
- 不得提交与后台开发模板相似度过高的小游戏;
- 不得仅简单修改美术/UI/素材就上线多个"基本一致"的小游戏。

> 结论:纯换皮量产**违规**,微信在收紧;2024 年起小游戏需备案。个人不宜走"商业换皮"这条路。

**链接:**
- 小游戏"换皮"博出位,8 万元打包高仿 10 款 — https://m.bjnews.com.cn/detail/1727596637129943.html
- "换皮"上线:小游戏市场的灰色生意 — https://xinwen.bjd.com.cn/content/s66deb2c7e4b01a5d71c86cae.html
- 代工搞开发换皮就上线(央广网) — http://m.cnr.cn/tech/20240909/t20240909_526894891.html
- 疯狂的小游戏:2 周开发成本 10 万月入 4 亿(新浪) — https://finance.sina.com.cn/tech/roll/2025-04-22/doc-inetzenw7837705.shtml

---

## 2. 资源分三层(② 资源在哪)

| 层 | 性质 | 用途 |
|---|---|---|
| 开源 demo | 免费、玩具级 | 学原理 |
| 引擎模板 | Cocos/Laya/Unity | 真正"一套模板"的来源 |
| 商业成品 | 付费、版权存疑 | 直接换皮(有风险) |

**开源 / 学习(GitHub):**
- 官方示例 `wechat-miniprogram/minigame-demo` — https://github.com/wechat-miniprogram/minigame-demo
- `Data-Camp/WeApp_Demos`(120+ 小程序/小游戏) — https://github.com/Data-Camp/WeApp_Demos
- `Aimee1608/wechatGame-all`(小游戏源码合集) — https://github.com/Aimee1608/wechatGame-all
- `dotgreg/weixin-minigame-tutorial`(Phaser 做 Flappy Bird) — https://github.com/dotgreg/weixin-minigame-tutorial
- `caochao/cocos-creator-h5-wxapi`(Cocos/H5 接微信 API) — https://github.com/caochao/cocos-creator-h5-wxapi
- `wechat-miniprogram/minigame-unity-webgl-transform`(Unity 转微信) — https://github.com/wechat-miniprogram/minigame-unity-webgl-transform
- `Leo501/awesome-CocosCreator` — https://github.com/Leo501/awesome-CocosCreator
- `potato47/awesome-cocos-creator` — https://github.com/potato47/awesome-cocos-creator

**引擎发布文档:**
- Cocos 发布到微信小游戏 — https://docs.cocos.com/creator/3.8/manual/zh/publish/publish-wechatgame.html
- LayaAir 微信小游戏 — https://layaair.com/3.x/doc/released/miniGame/wechat/readme.html

**商业模板市场:**
- 爱给网(游戏源码,免费+付费) — https://www.aigei.com/s?q=cocos+creator&type=code
- 互站网(源码集市) — https://www.huzhan.com/code/menu/@1_4

---

## 3. 三品类商品级比价(③ 解压 / 放置 / 模拟经营)

实测两个渠道(爱给网/Cocos 商城前端是 JS 渲染 + 反爬,列表抓不到;互站网和 CSDN 盘点帖能拿到价)。

### 渠道 A:Cocos 商城(正规、贵、带多端广告 SDK,可商用授权)

| 商品 | 品类 | 引擎 | 价格 | 链接 |
|---|---|---|---|---|
| 放置超市大亨(完整版,含微信/抖音/QQ 工程) | 放置经营 | Cocos 2.3.4+ | **¥2999** | https://store.cocos.com/app/detail/5024 |
| 我的汉堡餐厅(正式版,含微信/抖音/手Q 广告 SDK) | 模拟经营 | Cocos 3.8.0 | **¥3988** | https://store.cocos.com/app/detail/5345 |
| 医院模拟器(含激励视频广告) | 模拟经营 | Cocos | 见商品页 | https://store.cocos.com/app/detail/5760 |
| 梦幻厨房(140 关) | 模拟经营 | Cocos | 见商品页 | https://store.cocos.com/app/detail/3343 |
| 我要开镖局 | 模拟养成 | Cocos 2.4.3 | 5 折促销 | https://store.cocos.com/app/detail/6109 |
| 外婆的小农院 | 农场经营 | Cocos | 见商品页 | https://store.cocos.com/app/detail/5988 |

### 渠道 B:互站网源码集市(便宜、杂、PHP 后台、版权存疑)

| 商品 | 品类 | 技术栈 | 价格 |
|---|---|---|---|
| 精品小游戏近 30 款(合集) | 混合 | ThinkPHP | ¥298 |
| 合成植物大战僵尸 | 合成/放置 | ThinkPHP | ¥298 |
| 潮玩宇宙方块兽 | 放置挖矿 | ThinkPHP | ¥999 |
| 熊猫大亨 | 模拟经营 | Uniapp | ¥27800 |
| 五杀大逃杀 | 竞技 | PHP | ¥6800 |

CSDN 盘点帖(含试玩,本质是源码中介引流,质量/版权自验):
- 7 款模拟经营源码盘点 — https://blog.csdn.net/6346289/article/details/142376074
- 模拟经营源码曝光 — https://blog.csdn.net/6346289/article/details/137909414

### 三品类换皮难度结论

```
解压/拆螺丝  <  答题/模拟经营  <  放置养成
(改素材即可)   (换题库/数值)     (数值+联网+后台,抄不动)
```

- 正规成品认准"含微信/抖音工程 + 广告 SDK",¥3000 档。
- 只想拆开学玩法 → 互站 ¥298 合集 / 爱给网免费版。
- ¥2 万以上(熊猫大亨)是给工作室直接运营的,个人别碰。

---

## 4. 「咸鱼之王」= 放置卡牌 RPG(④ 用户的真实偏好)

> 注意正名:用户说的是**咸鱼之王**(咸鱼,非闲鱼)。疯狂游戏 2021 年微信小游戏爆款,三国题材**放置卡牌 RPG**(抽卡武将 + 回合制自动战斗 + 离线挂机 + 养成),业内称"广告之王"(2023 年投放 189 万组广告素材)。

它是换皮里**最难、最贵的一档**:

| 维度 | 拆螺丝(易换皮) | 咸鱼之王(难换皮) |
|---|---|---|
| 核心 | 关卡 JSON + 素材 | 抽卡概率 + 武将数值 + 战斗公式 + 养成线 |
| 后端 | 几乎无 | 必须联网(账号/存档/排行榜/抽卡) |
| 后台 | 无 | 运营后台(发奖/抽卡配置/活动) |
| 变现 | 广告 | 广告 + 内购(抽卡付费) |
| 换皮成本 | 改素材即可 | 皮好换,**数值与留存抄不动** |

> 结论:皮好换,但"咸鱼之王之所以是咸鱼之王"的数值和买量打法抄不走。个人不现实 → **转向自己实现一套**。

**链接:**
- 维基:咸鱼之王 — https://zh.wikipedia.org/zh-hans/咸鱼之王
- 放置游戏-咸鱼之王分析/源码搭建(CSDN) — https://blog.csdn.net/oZhaoQian/article/details/135741076
- Cocos 社区:10 分钟整包换皮工具(换皮产业的工具层) — https://forum.cocos.org/t/topic/175993
- 小程序/小游戏反编译取源码(仅原理认知) — https://blog.csdn.net/qq_44860866/article/details/125601132

---

## 5. 自己做一套:技术选型与思路(⑤ → 本项目)

**目标:** 做个能玩的成品(不追求上线微信小游戏)。

**技术栈:纯 Web + React + TypeScript。** 理由:
- 放置卡牌战斗表现极轻(两排单位按数值互打),**90% 是 UI 面板 + 状态 + 数值**,正好吃前端长处。
- 选 Cocos 要先交"学引擎"的学费,不服务"做个能玩的成品"的目标。
- 核心数值/战斗逻辑是纯 TS,**以后想上微信小游戏能直接搬走**,不浪费。

**关键决策:逻辑与表现解耦。** 战斗内核只算数值、产出一串 `BattleEvent` 事件流;表现层照事件逐个播放。好处:数值可单测、战斗可回放、改特效不动逻辑。

**UI / 美术怎么搞定(前端做游戏唯一的坎):**
```
游戏感 = 美术素材(AI 生图 + 素材包) + 质感排版(CSS) + 动效反馈(前端主场)
```
- 立绘/背景:AI 生图(即梦/Midjourney/通义万相),Q 版卡通 AI 最擅长。
- 图标:game-icons.net(4000+ 免费 SVG) — https://game-icons.net
- 质感:CSS 九宫格边框(`border-image`)、品质色(R蓝/SR紫/SSR金)、金色描边文字。
- 动效/特效分档:CSS+framer-motion(轻) → Lottie(中) → 序列帧 → Spine/Pixi(重)。
  - Lottie 免费库:https://lottiefiles.com
- 打击感 80% 来自"震屏 + 顿帧 + 飘字",纯代码零素材,优先做。

**MVP 核心循环:**
```
抽卡(耗钻) → 编队 → 自动推图(战斗) → 挂机收益 → 升级武将 → 回到抽卡
```

> 后续实现与验证情况见 `roadmap.md`。
