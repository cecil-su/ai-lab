# 跨AI终端互通讨论方案调研

## Goal

产出一份系统性的调研报告,回答"如何让 Claude Code、Codex、OpenCode、Reasonix 等不同 AI 终端相互沟通讨论",给出候选方案对比与推荐路线,供用户拍板后再进入实现。本任务只交付报告,不落地任何互通实现。

## Background(仓库/环境已确认事实)

### 本机 CLI 可用性

- `claude` → scoop shim,已安装
- `codex` → scoop shim,已安装
- `opencode` → scoop shim,已安装
- `reasonix` → npm 全局包 `reasonix@1.8.0-rc.1`,已安装
- `trellis` CLI **未安装**(PATH 中无此命令,npm 全局与本地 node_modules 均无)

### 仓库已有的相关设施

1. **trellis channel(设计文档齐全,CLI 缺失)** — `.claude/skills/trellis-channel/`
   - 定位是"本地多代理协作运行时":durable event log 频道、spawn 对等 worker、send/wait/interrupt、forum 频道;触发场景明确包含"和 codex/claude 讨论"。
   - `spawn --provider <claude|codex>`:当前适配器只支持 claude 和 codex,不含 opencode/reasonix(`.claude/skills/trellis-channel/references/workers.md:28`)。
   - 支持 agent card(`.trellis/agents/<name>.md`)、上下文注入(`--file`/`--jsonl`)、并行评审(Pattern C)、多轮 brainstorm(Pattern A)。核心状态逻辑在 `@mindfoldhq/trellis-core`。
2. **AGENTS.md 子代理协作规则** — Reasonix(`reasonix run --max-steps 8`)和 Cursor agent(`agent --print --mode=plan`)的 one-shot 子进程调用模式:单向派工,非多轮互聊。
3. **debate-council skill** — Claude Code 内部 subagent 多视角对抗评审(单一厂商内部,非跨 CLI)。
4. **workflow-agents.md** — Hermes-Agent 分层编排笔记(上层验收 + 下层廉价执行 + 辩论团队),反映用户对多代理协作模式的既有认知与偏好。
5. **apps/counciltrace** — 只读辩论 trace 查看器(确定性 runner,不调真实模型),可作为讨论过程可视化的潜在落点。

## Requirements

R1. 逐一调研四个终端的互通相关能力,以本机实测(`--help`、headless one-shot 探测)结合官方文档为准:
   - headless / 非交互模式(如 `claude -p`、`codex exec`、`opencode run`、`reasonix run`)
   - 会话续接能力(resume / thread id)
   - MCP client/server 支持
   - SDK / 编程接口(如有)
R2. 至少覆盖并对比以下候选路线,每条给出工作机制、依赖、工作量级、优缺点:
   - 路线一:trellis channel 底座(安装 CLI + 扩展 opencode/reasonix provider 适配器)
   - 路线二:自研轻量方案(共享讨论文件/信箱 + 各 CLI headless 轮流发言)
   - 路线三:MCP 聊天室(共享 MCP server,各终端作为 client 接入)
   - 调研中发现的其他可行路线(如各终端自带的 agent-to-agent 机制)
R3. 对比维度至少包含:接入工作量、多轮讨论支持、完成信号/编排可靠性、审计与可观测性、对新终端的扩展性、与仓库现有设施(trellis、debate-council、counciltrace)的复用关系。
R4. 给出明确的推荐路线和分阶段落地建议(MVP → 扩展),并列出已识别风险与未验证假设。
R5. 报告以中文写入本任务 `research/` 目录,并遵循 trellis-research 的持久化约定。

## Acceptance Criteria

- [x] 报告覆盖 R1 四个终端的能力矩阵,每项能力标注证据来源(本机命令输出或官方文档链接)。
- [x] 报告包含 R2 至少三条候选路线的对比表与 R3 全部对比维度(实际覆盖四条,含调研新发现的 ACP 路线)。
- [x] 报告给出唯一推荐路线 + 备选,并说明推荐理由与放弃其他路线的代价。
- [x] 探测仅限只读命令与最小 one-shot 问答(opencode、reasonix 各一次);未安装新全局依赖,未修改产品代码。
- [x] 报告文件:`research/cross-cli-communication-survey.md`。

## 用户决策(报告评审后追加)

- 2026-07-29:**落地方案不与 Trellis 绑定**。编排器须为独立 `lab/` 项目,不依赖 trellis CLI/包,讨论模板与产物自包含、可迁出本仓库。路线一(trellis channel)出局;推荐调整为"路线二自研轻量编排器,备选路线四 ACP"。报告已同步更新。

## Out of Scope

- 安装 trellis CLI 或任何互通方案的实际落地实现(留待用户基于报告拍板后另行开工)。
- 修改 `.claude/skills/`、AGENTS.md、CLAUDE.md 等现有配置。
- counciltrace 的功能开发。
