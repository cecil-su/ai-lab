# 跨 AI 终端互通讨论方案调研报告

日期:2026-07-29
任务:`.trellis/tasks/07-29-cross-cli-agent-chat`
调研对象:Claude Code 2.1.218、Codex CLI 0.145.0、OpenCode 1.18.9、Reasonix 1.8.0-rc.1(均为本机实测版本)

---

## 一、结论摘要

**推荐路线:先在 `lab/` 自研轻量编排器(路线二)落地 MVP,接口层按 ACP(Agent Client Protocol)方向预留演进;备选路线:直接以 ACP 为接口层实现编排器(路线四)。**

> 用户决策(2026-07-29):**落地方案不与 Trellis 绑定**——编排器不依赖 trellis CLI/包,讨论产物不落 `.trellis/`,方案可独立迁移到任何仓库使用。路线一(trellis channel)因此出局,仅保留分析供参考。

核心依据:

1. 四个终端的 headless one-shot + 会话续接能力**全部实测/文档确认可用**,这意味着"多轮讨论"不依赖任何新基础设施,一个编排脚本即可实现四方互聊。
2. trellis channel 虽然设计完备且仓库 skill 文档齐全,但实测发现 CLI 未安装、npm 包为早期版本 `@mindfoldhq/trellis@0.6.10`,且 provider 适配器**只支持 claude 和 codex**,opencode/reasonix 的扩展机制未知(可能需要 fork)。
3. 调研中发现一条此前未列入的路线:**ACP 统一总线**。opencode 和 reasonix 都原生自带 `acp` 子命令,claude/codex 有现成适配器,2026 年 ACP 生态(Zed、JetBrains、VS Code、Microsoft Intelligent Terminal)正在快速收敛,是中长期最值得押注的标准接口。

---

## 二、四终端能力矩阵(证据:本机命令输出)

| 能力 | Claude Code 2.1.218 | Codex CLI 0.145.0 | OpenCode 1.18.9 | Reasonix 1.8.0-rc.1 |
|---|---|---|---|---|
| Headless one-shot | ✅ `claude -p "<prompt>"` | ✅ `codex exec "<prompt>"` | ✅ `opencode run "<msg>"` **(实测跑通,返回 OK)** | ✅ `reasonix run --max-steps N "<task>"` **(实测跑通,返回 OK + token 统计)** |
| 结构化输出 | ✅ `--output-format json\|stream-json`、`--json-schema` | ✅ `--json`(JSONL 事件流)、`-o` 末条消息落盘、`--output-schema` | ✅ `run --format json` | ⚠️ 仅 `--metrics <path>`(JSON 成本统计),正文无结构化格式 |
| 流式/双向输入 | ✅ `--input-format stream-json`(常驻进程双向流) | ❌ exec 为一次性;`app-server`/`--remote`(ws)为实验特性 | ✅ `serve`(headless HTTP server)+ `attach`/`run --attach` | ✅ `serve`(HTTP+SSE) |
| 会话续接 | ✅ `--resume <id>`、`--session-id <uuid>`、`--fork-session` | ✅ `codex exec resume`(`--last` 或按 id) | ✅ `run -s <sessionID>`、`--fork`、`export/import` | ✅ `run --resume <PATH>`、`-c` |
| MCP client | ✅ `claude mcp add` | ✅ `codex mcp` | ✅ `opencode mcp` | ✅ `reasonix mcp add/remove/list` |
| 作为 MCP server | ✅ `claude mcp serve` | ✅ `codex mcp-server`(stdio) | ❌ 未见(`serve` 是自有 HTTP API,非 MCP) | ❌ 未见 |
| ACP(Agent Client Protocol) | ⚠️ 官方适配器 `@agentclientprotocol/claude-agent-acp`(原 `@zed-industries/claude-code-acp`) | ⚠️ 社区适配器 codex-acp(Rust)/ acp-adapter(Go,一并桥接 Codex/Claude Code/Pi) | ✅ 原生 `opencode acp`(stdio) | ✅ 原生 `reasonix acp`(stdio,亦可 `--acp`) |
| 后台/服务器形态 | ✅ `--bg` 后台 agent + `claude agents` 管理 | ⚠️ `app-server`、`remote-control`(实验) | ✅ `serve`、`web`、mDNS 发现 | ✅ `serve`、`bot`(IM 网关) |
| 子代理/编排原语 | ✅ `--agents <json>` 自定义子代理 | ⚠️ 依赖 `.agents/skills/debate`(仓库内 Codex 辩论技能,内部编排) | ✅ `agent` 管理命令 | ⚠️ 单代理为主 |

> 一次性 one-shot 探测各消耗了一次最小模型调用(reasonix 实测 in 14213 / out 31 tokens),claude/codex 的 headless 模式为业界成熟用法未重复消耗。

---

## 三、候选路线对比

### 路线一:trellis channel 底座

**机制**:安装 `@mindfoldhq/trellis`,用其 channel 运行时——durable event-log 频道 + `spawn` 对等 worker(子进程 headless CLI)+ `send/wait/interrupt` 编排原语 + forum 频道。仓库 `.claude/skills/trellis-channel/` 已有完整使用文档(多轮 brainstorm Pattern A、并行评审 Pattern C 等)。

**实测现状**:
- `trellis` CLI 本机未安装(PATH、npm 全局、本地 node_modules 均无)。
- 正确的包是 **`@mindfoldhq/trellis@0.6.10`**;⚠️ 注意裸名 `trellis@3.4.2` 是一个无关的 "Agentic State Engine" 包,**`npx trellis` 会装错**。
- `spawn --provider <claude|codex>` 白名单校验("validated against the adapter registry",见 `.claude/skills/trellis-channel/references/workers.md:28`),**不含 opencode/reasonix**;是否支持插件式扩展 adapter 未验证,可能需要 fork 或提上游 PR。

**优点**:编排原语最完整(`wait --kind done`、软/硬中断、OOM guard、审计事件日志);与仓库 Trellis 工作流(task、jsonl、agent card)深度集成;skill 文档现成,claude↔codex 零开发即可用。
**缺点**:0.6.x 早期版本,依赖第三方演进;opencode/reasonix 接入工作量未知且不受自己控制;装错包的坑。

**工作量级**:claude↔codex:小(装包 + 验证)。四终端全通:未知,可能中~大(取决于 adapter 扩展机制)。

### 路线二:自研轻量编排器(推荐)

**机制**:在 `lab/`(如 `lab/agent-roundtable/`)写一个小编排器脚本:
1. 一份共享讨论记录(markdown 或 JSONL);
2. 每轮把"议题 + 此前各方发言"投喂给当轮发言的终端,用各自 headless + 续接命令保持会话记忆:
   - `claude -p --resume <id> --output-format json`
   - `codex exec resume --last --json`
   - `opencode run -s <sessionID> --format json`
   - `reasonix run --resume <path>`
3. 发言写回讨论记录,按轮次表(round-robin / 主持人点名 / 辩论模式)推进,设定停止条件(轮数上限或收敛判定)。

**可行性已验证**:四家 headless 全部实测/确认可用,续接机制齐全;reasonix 无结构化正文输出,取 stdout 文本即可(实测输出干净)。

**优点**:零新依赖、当天可出 MVP、四终端即刻全通、编排逻辑(谁发言/何时停/如何裁决)完全自主可控,天然匹配 `lab/` 实验文化;讨论记录本身就是审计日志;可直接复用 `debate-council`/`.agents/skills/debate` 里沉淀的辩论模式设计(角色、轮次、裁决)。
**缺点**:完成信号、超时、异常重试要自己写(但 one-shot 模式下就是"子进程退出",远比常驻 worker 简单);长期堆功能会重复造 trellis channel 的轮子——所以要克制在"讨论"场景,不做通用 worker 池。

**工作量级**:MVP 小(一个脚本 + 提示词模板);可增量演进。

### 路线三:MCP 聊天室

**机制**:自建一个"聊天室 MCP server"(提供 `post_message` / `read_messages` / `wait_for_turn` 等工具),四个终端全部配置为 MCP client 接入,讨论通过工具调用进行。

**可行性**:四家 MCP client 能力全部确认 ✅;另外 claude/codex 还能反向作为 MCP server 被对方直接挂载(`claude mcp serve` / `codex mcp-server`),即"codex 把 claude 当工具调用"这种主从形态零开发即可实现。

**关键局限**:MCP 只解决**消息通道**,不解决**回合编排**——agent 不会自己醒来轮询聊天室,仍需一个宿主进程逐轮驱动各终端(headless 调用),等于路线二的编排器照样要写,只是消息从"拼进 prompt"变成"工具调用"。每轮多出工具调用往返,token 成本更高。

**优点**:协议标准、厂商中立;聊天室 server 可复用给未来任何 MCP client;人类也能通过 MCP inspector 旁观/插话。
**缺点**:四端各需一次 MCP 配置;编排问题依旧存在;实现成本 ≈ 路线二 + 一个 MCP server。

**工作量级**:中。

### 路线四(调研新发现):ACP 统一总线

**机制**:[ACP(Agent Client Protocol)](https://agentclientprotocol.com/get-started/agents) 是 Zed 发起的 JSON-RPC 2.0 标准("agent 界的 LSP"),让任意 agent 进程以统一协议被任意宿主驱动。写一个 ACP client 编排器,以同一套代码 spawn 四个 agent 子进程并转发消息:
- opencode:原生 `opencode acp` ✅
- reasonix:原生 `reasonix acp` ✅
- claude:官方 SDK 适配器 [`@agentclientprotocol/claude-agent-acp`](https://www.npmjs.com/package/@zed-industries/claude-code-acp)(原 @zed-industries 包已迁移)
- codex:社区 codex-acp(Rust)或 [acp-adapter](https://github.com/beyond5959/acp-adapter)(Go,同时桥接 Codex/Claude Code/Pi)

**生态现状(2026)**:[Microsoft Intelligent Terminal 0.1 已内置 ACP agent 面板并自动发现 Copilot/Claude Code/Codex/Gemini CLI](https://codex.danielvaughan.com/2026/06/10/agent-client-protocol-microsoft-intelligent-terminal-codex-cli-multi-agent-ide-ecosystem/);JetBrains 与 Zed 内置 ACP Agent Registry;协议版本 v0.13.6;[AI SDK 有社区 ACP provider](https://ai-sdk.dev/providers/community-providers/acp),[Mastra 已支持将 agent 暴露为 ACP](https://mastra.ai/blog/introducing-agent-client-protocol)。

**优点**:一份编排代码接入所有 agent,消除四种 CLI 的接口差异;原生流式;新终端(Gemini CLI、Copilot CLI 等)加入几乎零成本;是四条路线中唯一"接口层随行业标准走"的。
**缺点**:ACP 定义的是 agent↔宿主 协议,**不含 agent↔agent 讨论编排语义**,编排器仍要自己写;claude/codex 靠适配器,成熟度参差;协议仍在 0.x 快速演进。

**工作量级**:中(编排器 + 适配器集成调试)。

---

## 四、对比总表

| 维度 | 路线一 trellis channel | 路线二 自研轻量 | 路线三 MCP 聊天室 | 路线四 ACP 总线 |
|---|---|---|---|---|
| 四终端全通的接入工作量 | ❓ 未知(adapter 缺口) | ✅ 小 | 中 | 中 |
| 多轮讨论支持 | ✅ 原生(Pattern A) | ✅ resume + 记录回灌 | ✅ 但需外部驱动回合 | ✅ 流式会话 |
| 完成信号/编排可靠性 | ✅ 事件 kind + wait | ✅ 进程退出即完成(one-shot 最简) | ⚠️ 需自定义协议约定 | ⚠️ 需自定义编排层 |
| 审计与可观测性 | ✅ 事件日志 + messages/forum | ✅ 讨论记录文件即日志 | 中(server 端留痕) | 中(需编排器落盘) |
| 对新终端的扩展性 | ❌ 受上游 adapter 白名单限制 | 中(每家写一小段调用封装) | 高(只要是 MCP client) | ✅ 最高(ACP 生态标准) |
| 与仓库现有设施复用 | ✅ 最高(task/jsonl/skills) | ✅ 高(debate-council 模式、counciltrace 可视化、lab/ 惯例) | 中 | 中 |
| 外部依赖风险 | 高(0.6.x + 装错包坑) | 无 | 低 | 中(适配器成熟度) |

---

## 五、推荐路线与分阶段落地建议

**唯一推荐:路线二(自研轻量编排器),接口层为路线四(ACP)预留演进。备选:路线四(直接以 ACP 为接口层实现编排器)。**

约束前提:落地方案不与 Trellis 绑定(用户决策)。编排器作为独立的 `lab/` 项目实现,不依赖 trellis CLI/包,讨论模板与产物自包含,可整体迁出本仓库使用。

放弃其他路线作为主路线的代价说明:
- 路线一(trellis channel):因"不绑定 Trellis"约束出局。损失其现成编排原语(wait/interrupt/事件日志),这些能力在 one-shot 编排模型下实现成本很低(进程退出即完成信号),可接受。
- 不选路线三:损失"标准化消息通道",但 MCP 并不能免去编排器,主路线里它只是可选增强件。
- 不直接上路线四:ACP 适配器(尤其 codex 侧)成熟度未实测,直接押注会把 MVP 拖入适配器调试;先用原生 CLI 跑通讨论,再切接口层,风险更低。它作为备选:若 MVP 阶段就发现原生 CLI 封装维护成本高,可提前切换。

**分阶段建议**:

- **阶段 0(MVP,1 天级)**:`lab/agent-roundtable/` 建最小编排器——议题文件 + 轮次驱动 + 四终端 headless 调用 + 讨论记录落盘(落在编排器自己的 `sessions/` 输出目录)。跑一个真实议题(比如就本仓库某个技术选型让四家辩论),验证讨论质量、时延与 token 成本。
- **阶段 1(讨论模式沉淀)**:参考 `debate-council` / `.agents/skills/debate` 的模式(对抗辩论、评审团、红队)设计编排器自带的轮次模板(模板随编排器走,不引用仓库 skill 文件);可选把讨论 trace 喂给 `apps/counciltrace` 做可视化。
- **阶段 2(接口层演进,观察触发)**:当出现以下任一信号时,把"终端调用封装"切换为 ACP client:① 想接入更多终端(Gemini CLI 等);② codex/claude 的 ACP 适配器实测稳定;③ 需要流式互动而非回合制。

---

## 六、风险与未验证假设

1. **trellis adapter 扩展机制未验证**:未阅读 `@mindfoldhq/trellis` 源码,不确定 provider 白名单能否插件化扩展;若要走路线一全通,需先做此验证。
2. **codex ACP 适配器未实测**:codex-acp / acp-adapter 只做了文献确认,未在本机跑通。
3. **reasonix 无结构化正文输出**:编排器只能取纯文本 stdout(实测干净可用),若未来需要结构化裁决,需在提示词层约定格式。
4. **opencode headless 默认配置耦合用户全局设置**:实测走的是用户配置的 `orchestrator · gpt-5.6-sol`,编排器应显式传 `-m provider/model` 固定模型,避免行为漂移。
5. **成本**:多轮 × 多终端的 token 消耗线性放大(reasonix 单次最小调用已 14k input tokens,因为会注入项目上下文);编排器应支持 `--max-rounds` 与按终端裁剪上下文。
6. **各 CLI 均在快速迭代**(本报告锚定本机版本号),headless 旗标可能变化;编排器封装层应把每家的调用命令收敛到一个文件便于维护。

---

## Sources

- [@zed-industries/claude-code-acp — npm](https://www.npmjs.com/package/@zed-industries/claude-code-acp)
- [Agent Client Protocol — Agents](https://agentclientprotocol.com/get-started/agents)
- [ACP in Microsoft Intelligent Terminal — Codex Knowledge Base](https://codex.danielvaughan.com/2026/06/10/agent-client-protocol-microsoft-intelligent-terminal-codex-cli-multi-agent-ide-ecosystem/)
- [MCP, ACP, and A2A in Practice — Codex Knowledge Base](https://codex.danielvaughan.com/2026/05/01/codex-cli-agent-interoperability-protocols-mcp-acp-a2a/)
- [acp-adapter (Go) — GitHub](https://github.com/beyond5959/acp-adapter)
- [AI SDK Community Providers: ACP](https://ai-sdk.dev/providers/community-providers/acp)
- [Mastra: Introducing Agent Client Protocol Support](https://mastra.ai/blog/introducing-agent-client-protocol)
- 本机实测命令输出(2026-07-29):`claude --help` / `claude mcp --help`、`codex --help` / `codex exec --help`、`opencode --help` / `opencode run --help`(one-shot 实测)、`reasonix --help` / `reasonix run --help`(one-shot 实测)、`npm view @mindfoldhq/trellis`、`npm ls -g`
