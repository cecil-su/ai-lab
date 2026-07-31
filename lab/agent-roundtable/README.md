# roundtable

独立的多 AI 终端话题讨论 CLI:让 **claude / codex / opencode / reasonix** 围绕一个话题多轮互聊。roundtable 只做**调度 + 会话管理**——每位参与者的模型调用复用各自 CLI 已有的登录态,工具本身不管理任何 API key、不连接任何服务(含本仓库的 agentparty)。目录自包含,可整体迁出本仓库使用。

## 安装 / 构建

```bash
pnpm install                              # 仓库根安装依赖(已覆盖 lab/*)
pnpm -F agent-roundtable build            # tsc 编译到 dist/(bin: dist/cli.js → roundtable)
pnpm -F agent-roundtable doctor           # 自检四家 CLI 的可用性与版本
```

`doctor` 输出示例(缺失的 CLI 会标 `missing`,开题时该 provider 不可选):

```
  claude     ok       2.1.220
  codex      ok       0.145.0
  opencode   ok       1.18.9
  reasonix   ok       1.8.0-rc.1
```

运行方式(下文示例统一用 `roundtable`,等价写法二选一):

- 开发直跑(无需构建):`pnpm -F agent-roundtable dev <args>`(内部 `tsx src/cli.ts`)
- 构建后:`node dist/cli.js <args>`,或将 bin `roundtable` 链接到 PATH 后直接 `roundtable <args>`

## 快速开始

### new — 开题并前台运行

`--providers` 至少 2 个(逗号分隔);`--perspectives` 按参与者顺序一一对应(缺省时自动轮流分配内置模板);`--mode` 默认 `roundtable`;`--max-rounds` 默认 3。

```bash
# 圆桌:claude 与 codex 就缓存选型聊 3 轮(默认模式/轮数)
roundtable new "服务端缓存选型:Redis vs 进程内存" --providers claude,codex

# 辩论 + 指定视角 + 4 轮:交锋结束自动追加裁决轮并生成 summary.md
roundtable new "是否值得为该功能引入消息队列" \
  --providers claude,codex,opencode,reasonix \
  --perspectives architect,cost,redteam,pragmatist \
  --mode debate --max-rounds 4

# 覆盖模型(所有参与者统一用该 model 覆盖各家默认)
roundtable new "选型:tRPC vs REST" --providers opencode,reasonix --model gpt-5.6-sol

# 零成本演练:mock provider 从脚本读预设发言(不消耗真实 token)
roundtable new "演示话题" --providers mock:./fixtures/a.txt,mock:./fixtures/b.txt

# 注入参考材料:把文件读进 charter 的「## 参考材料」段,所有参与者(含 claude)都能读到
roundtable new "审查这个模块的设计缺陷" --providers claude,codex \
  --context-file README.md,src/engine/runner.ts
roundtable new "审查 src 目录" --providers claude,codex \
  --context-dir src/engine --context-glob "*.ts"

# 自读:enforced provider 可直接使用;未强制只读的 provider 默认拒绝
roundtable new "审查本仓库的架构缺陷" --providers claude,codex --repo .
# 若明确接受 OpenCode/Reasonix 可能越界写的风险,必须显式覆盖
roundtable new "审查本仓库的架构缺陷" --providers opencode,reasonix --repo . --allow-unsafe-repo
```

**接触代码的两条路线**(可叠加):
- `--context-file` / `--context-dir`(**递归**子目录,可配 `--context-glob "*.ts"` 按文件名过滤)**注入**:把文件嵌入 charter,**所有参与者(含 claude)**都能读到;材料随 charter 每轮重发,注意 token,超 200KB 上限会**硬裁剪尾部文件**并在材料里列出被裁清单(不静默)。注入侧做了**降低指令混淆**的基础处理(材料前置"数据非指令"声明、动态代码围栏防逃逸、二进制文件跳过),但不等于安全隔离——被评审文件本就是不可信输入。
- `--repo <路径>` **自读(实验)**:发言子进程 cwd 指向该仓库,有文件工具的参与者自己 grep/read。claude 使用 `--permission-mode plan Read/Grep/Glob`,codex 使用 `-s read-only`,两者声明为 `enforced`;opencode/reasonix 仅继承各自默认权限,因此默认拒绝与 `--repo` 联用,必须加 `--allow-unsafe-repo` 才放行并显示风险告警。**注意**:即使是 enforced provider,只读也不等于项目指令/plugin/hook 隔离;自读路径仍会**绕过**注入侧围栏——仓库文件与 transcript 的"数据非指令"声明只降低指令混淆,不构成安全隔离。未设 `--repo` 时行为不变。

charter 还会附一行**讨论记录自读**提示:完整 `transcript.jsonl` 供有文件工具的参与者**按需**逐字回看全场(注入+增量仍是每轮主通道,常规发言无需读它,不重复烧 token)。

开题时在话题目录写入 `charter.md`(议题、参与者与视角、模式规则、停止条件),随后前台驱动回合。**Ctrl+C** 在当前发言完成后优雅暂停并落盘。

`--timeout <秒>` 调每次发言的子进程超时(默认 300)。**单个 provider 失败/超时不会炸掉整场**:该参与者本轮记一条 `⚠ 失败` 事件后跳过、其会话作废(下轮全量新会话),讨论继续,收尾正常落 `completed`;即便收尾/裁决本身失败,也会写一份说明失败原因的兜底 `summary.md`,不留"完成却无产物"。

### list — 列出全部话题

```bash
roundtable list            # 表格:id / 状态(active|paused|completed) / 模式 / 轮次进度 / 标题
roundtable list --json     # 结构化 frame(id/title/mode/status/round/participants+tokens)
```

### continue — 从暂停点恢复

```bash
# 恢复暂停(paused)的话题
roundtable continue 2026-07-30-redis-vs-memory

# 续谈:重开已完成(completed)话题,带一个追问继续深入(默认 +1 轮)
roundtable continue 2026-07-30-redis-vs-memory --ask "针对成本面再深入,给量化依据" --more 2
```

各参与者用持久化的 session 引用续接记忆,恢复后能引用之前的讨论内容。

**续谈**:`completed` 话题默认拒绝,但可用 `--ask "<追问>"`(可选 `--more <n>` 加轮、`--as <名字>` 指定插话人)**原地重开**——同一话题延续,追问作为插话注入,续跑后重生成 summary.md。数据全部留在原话题目录;换议题请另开 `new`。

### attach — TUI 查看 + 插话

```bash
roundtable attach 2026-07-30-redis-vs-memory            # 默认以 "human" 身份插话
roundtable attach 2026-07-30-redis-vs-memory --as cecil # 指定插话署名
```

进入 Ink TUI:滚动历史(按参与者着色,插话高亮)、状态栏(标题 / 模式 / 轮次 / runner 活跃 / 累计 token)、底部输入框。键位:

- **回车** 发送插话 → 写入 `inbox.jsonl`,runner 在下一轮把它搬进 transcript,所有模型可见
- **PgUp / PgDn** 回看历史(输入任意字符自动回到底部跟随)
- **`:stop`** 结束讨论(runner 在安全边界收尾)
- **q / Esc / Ctrl+C** 仅退出视图,不影响 runner 与话题状态

同一话题只允许一个 attach 持写入权(单写者);其余 attach 以 `[只读]` 模式跟随。退出 attach 后 runner 继续跑。

### show — 纯流式查看(TUI 保底 / 调试通道)

```bash
roundtable show <topic>           # 打印完整 transcript
roundtable show <topic> --follow  # 流式跟随新发言(Ctrl+C 退出)
roundtable show <topic> --json    # 输出 transcript 事件数组
```

### stop — 显式结束

```bash
roundtable stop <topic>   # runner 在跑则请求其收尾;否则直接置完成态
```

## 概念

### 话题目录结构

话题即本地目录(默认 `<包根>/topics/<topic-id>/`,`ROUNDTABLE_HOME` 环境变量可覆盖数据根):

| 文件 | 说明 |
|---|---|
| `topic.json` | 话题元数据与状态机(mode / status / maxRounds / currentRound / participants + sessionRef + tokens) |
| `charter.md` | 话题契约:议题、参与者与视角、模式规则、停止条件 |
| `transcript.jsonl` | 追加式事件日志,seq 严格递增,**单写者 = runner**(message/human/skip/verdict/round_end/system) |
| `inbox.jsonl` | 人类插话收件箱(attach 写,runner 消费) |
| `runner.lock` / `attach.lock` | 进程锁,死 pid 自动接管 |
| `summary.md` | 结束时生成(结论/裁决 + 各方立场摘要) |

进程模型:runner 前台进程是唯一"讨论驱动者";attach 是纯观察 + 插话进程,可多开。两者只通过话题目录下的文件通信。

### 两种模式

- **roundtable(圆桌)**:固定顺序 round-robin 平等发言;满轮数上限后收尾。
- **debate(辩论)**:各参与者代表自身视角的立场方,须为本方辩护并反驳对立观点;满轮数上限后追加**裁决轮**——由中立裁决人(第一位参与者的全新无记忆会话)输出结论 / 关键论据 / 分歧点 / 风险。

两种模式都有收敛熔断:连续两轮全体立场不变或全员跳过时自动收尾。

### 6 个内置视角

`--perspectives` 可用模板 id,也可传自由文本(未命中模板即按自由文本注入):

| id | 视角 |
|---|---|
| `architect` | 系统架构师:长期可维护性、模块边界、技术债与演进 |
| `security` | 安全工程师:攻击面、数据安全、权限边界、滥用场景 |
| `cost` | 成本视角:资源开销、运维负担、token/算力成本、投入产出比 |
| `ux` | 用户体验:端到端体验、易用性、错误反馈、心智负担 |
| `redteam` | 红队:主动证伪当前方案,找最可能崩溃的边界 |
| `pragmatist` | 务实工程师:最小可行方案、落地成本、交付风险 |

## 已知限制与成本提示

- **MVP 前台运行**:runner 是前台进程,Ctrl+C = 暂停(`continue` 无损恢复),关闭终端即中断当前发言。后台 daemon / detach 是 v2。
- **attach 真机键盘交互需真实 TTY**:插话/`:stop` 依赖终端 raw mode,请在 Windows Terminal 或 VS Code 集成终端运行;非 TTY 环境(如子进程/管道)自动降级为只读跟随。
- **token 成本随轮数 × 参与者数线性放大**。各家基线上下文注入差异大:实测单话题 codex input ~16 万 token(基线注入大),claude 仅 ~7.6k。建议用 `--max-rounds` 与参与者数量控制成本;讨论会话以只读/受限模式运行(cwd 指向话题目录以隔离仓库上下文、压 token)。
- **reasonix 需 npm 版**(1.8.0-rc.1),而非 scoop 旧版;本机双装时以 npm 全局入口为准(doctor 已按此探测)。

## v2 预留

后台 daemon(detach 不中断讨论)、远程参与者(SSH transport 出站 / 自建频道服务 `serve` 入站客座)、ACP 接口层——架构已预留缝(topic.json `transport` 字段、store 层纯函数形态),MVP 均不实现。
