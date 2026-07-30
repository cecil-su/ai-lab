# roundtable CLI:多AI终端话题讨论工具

## Goal

一个独立的 CLI 工具(工作名 `roundtable`):用户选择参与终端(claude/codex/opencode/reasonix)、视角(角色)和讨论模式,围绕一个话题进行多轮 AI 讨论;话题持久化,可 list/继续,可进入话题以 TUI 查看对话并插话,随时退出/停止。不依赖 Trellis,不依赖任何第三方服务。

## Background

- 前置调研:`.trellis/tasks/archive/2026-07/07-29-cross-cli-agent-chat/research/cross-cli-communication-survey.md`。四终端 headless one-shot + 会话续接均已实测/确认(具体命令见 Technical Notes)。
- 借鉴对象:`vendor/agentparty`(仅借鉴设计,不复用代码/服务):seq 游标追加历史、`ask` 语义、`charter` 话题契约、`digest` 补课摘要、loop guard、`--json` frame 命令面。

## 约束与已定决策

- C1. 不依赖 trellis CLI/包,产物不落 `.trellis/`;不引入任何外部服务(含本仓库 agentparty-main-service);工具目录可整体迁出仓库使用。
- D1. 进程模型:MVP 前台运行,Ctrl+C 在安全边界优雅暂停,`continue` 无损恢复;runner 与查看器(attach)从第一天分离,仅通过话题目录下的文件通信,v2 runner 后台化零重构。
- D2. 放置与语言:`lab/agent-roundtable/`,TypeScript/Node 24,pnpm workspace 成员,`"private": true`。
- D3. 消息底座:独立自持。话题 = 本地目录(`topic.json` + `transcript.jsonl` 追加式事件日志,seq 递增)。
- D5. MVP 范围 = 标准包:四终端全接;模式 2 种(自由圆桌 round-robin、对抗辩论含裁决轮);预置视角模板 + 自由文本自定义;停止 = 轮数上限(默认 3)+ 裁决轮收尾 + 随时可停。
- D6. attach 形态:交互式 TUI(Ink):滚动历史 + 跟随、状态栏(参与者/轮次/token 统计)、输入框插话。

(以上均为用户拍板,2026-07-29。)

## Requirements

- R1 **开题**:`roundtable new "<话题>"`,通过 flags 或交互式向导选择:参与终端(≥2,可全选四家)、每位参与者的视角(预置模板或自由文本)、模式(`roundtable` | `debate`)、轮数上限、(可选)各终端 model 覆盖。开题时生成话题 charter(议题、参与者与视角、模式规则、停止条件)写入话题目录。
- R2 **讨论执行**:前台 runner 按模式驱动回合;每轮每参与者一次 headless 调用,保持各自 CLI 会话续接;发言以 seq 递增事件追加进 `transcript.jsonl`;上下文投喂用"charter + 历史立场摘要 + 上一轮全文"控制 token;Ctrl+C 在当前发言完成后优雅暂停并落盘状态。
- R3 **持久化与恢复**:`roundtable list` 列出全部话题(状态:讨论中/已暂停/已完成 + 轮次进度);`roundtable continue <topic>` 从暂停点恢复,各终端用持久化的 session 引用续接记忆。
- R4 **attach TUI**:`roundtable attach <topic>` 进入话题:渲染历史对话(按参与者着色)、runner 运行中实时跟随新发言、状态栏显示参与者/轮次/累计 token,底部输入框输入即插话(作为 human 参与者写入,下一轮所有模型可见),退出(q/Ctrl+C)只离开视图,不影响 runner 与话题状态。
- R5 **停止**:轮数上限自动收尾;debate 模式最后执行裁决轮;`roundtable stop <topic>` 或 TUI 内命令显式结束话题;结束时生成 `summary.md`(结论/裁决 + 各方立场摘要)。
- R6 **视角模板**:内置 6 个(架构师、安全、成本、用户体验、红队、务实工程师),模板随工具自包含;支持 `--perspective "<自由文本>"`。
- R7 **人机两用输出**:list/show 等命令支持 `--json` 输出结构化 frame;`roundtable doctor` 检测四家 CLI 的可用性与版本。

## Acceptance Criteria

- [ ] `roundtable new` 能以四家终端 + debate 模式开题并跑完一轮真实讨论;transcript.jsonl 中每条发言含 seq、参与者、轮次、正文。
- [ ] 讨论中途 Ctrl+C 后 `roundtable list` 显示"已暂停"及轮次进度;`continue` 恢复后,参与者的发言可引用暂停前的讨论内容(会话记忆延续)。
- [ ] `roundtable attach`(runner 运行中)能看到发言实时出现;输入一条插话后,下一轮至少一位参与者的发言对插话内容有回应;退出 attach 后 runner 不受影响。
- [ ] debate 模式在轮数上限后自动进入裁决轮并生成 summary.md;roundtable 模式在轮数上限后收尾。
- [ ] `roundtable doctor` 正确报告四家 CLI 的存在与版本;某家缺失时 new 向导中该选项不可选且有提示。
- [ ] mock provider 下的引擎端到端测试通过(不消耗真实 token);`pnpm -F agent-roundtable typecheck` 与单元测试全绿。
- [ ] 工具目录不 import 任何 `.trellis`/agentparty 代码,不发起对本地服务的网络请求。

## Out of Scope

- API 直连 provider(内置 API key 调模型)。适配器只封装本机已安装的 CLI 子进程,认证/计费复用各 CLI 自身登录态,roundtable 不管理任何密钥。(用户确认 2026-07-29)
- 后台 daemon / detach 不中断讨论(v2;D1 已为其预留架构)。
- 远程 AI 参与讨论(v2,用户拍板 2026-07-29):两种形态均不进 MVP——① SSH transport(远程机器上的 CLI 仍由调度器出站驱动);② 自建频道服务(`roundtable serve` + 邀请 token,远程 agent 入站加入,消息契约借鉴 AgentParty 自实现)。MVP 仅预留缝:topic.json participants 带 `transport` 字段(MVP 恒为 `local`),serve 边界见 design.md。
- ACP 接口层、AgentParty 频道镜像、更多讨论模式(评审团/红队/主持人动态点名)、收敛自动判定。
- 各终端的权限/沙箱策略深度配置(MVP 用各 CLI 默认安全模式,讨论场景本身只读)。

## Technical Notes(实测锚点)

- 各终端 headless 调用(本机验证版本):
  - claude 2.1.218:`claude -p --output-format json --resume <sessionId>`;新会话捕获 session id。
  - codex 0.145.0:`codex exec --json`;续接 `codex exec resume <threadId> --json`(thread id 从 JSONL 事件流捕获)。
  - opencode 1.18.9:`opencode run --format json -s <sessionID>`(实测跑通);建议显式 `-m provider/model` 固定模型,避免随用户全局配置漂移。
  - reasonix 1.8.0-rc.1:`reasonix run --resume <sessionPath>`(实测跑通);正文无结构化输出,取 stdout 文本;`--metrics <path>` 可采 token 统计。
- 成本参考:reasonix 单次最小调用 ~14k input tokens;上下文投喂策略(R2)与 token 统计展示(R4)由此而来。
- 发言协议:要求每位发言者正文末尾输出一行 `【立场】<一句话>`,runner 提取作为历史压缩的立场摘要(零额外模型调用的 digest);缺失时退化为截断。
