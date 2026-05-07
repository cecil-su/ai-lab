# OpenClaw + Hermes Agent 完整体验配方（macOS M1）

> 配套阅读：[`docs/openclaw-getting-started.md`](./openclaw-getting-started.md)
> 本地分析副本：`vendor/openclaw/`、`vendor/hermes-agent/`
> 版本：openclaw `2026.5.6` / hermes-agent `0.12.0`

这是一份**勾选式 checklist**，告诉你想完整体验两个项目的所有亮点功能，需要装哪些插件 / skills / MCP server，以及对应的 API key 在哪申请。

---

## 0. 配方总览

| 等级 | 投入 | 覆盖能力 |
| --- | --- | --- |
| **最小完整** | 1 杯咖啡 | 聊天 + 网搜 + 网页操作 + 一个 IM 远控 + 文件 + GitHub + 文档查询 |
| **标准** | 半天 | 上面 + 多 IM + 语音 + 长程记忆 + Google 套件 + 浏览器自动化 |
| **全开** | 一个周末 | 上面 + 国内 IM + 图片视频生成 + serverless 终端 + 所有 optional skills |

后面每个 checklist 都用 `[最小]` / `[标准]` / `[全开]` 标出归属。

---

## 1. 准备工作：API key 申请清单

下面这些 key 两个项目可以**复用同一把**（除了 IM bot token 各自独立）。

### 1.1 LLM provider（至少申请一家）

| 服务 | 申请地址 | 备注 |
| --- | --- | --- |
| OpenAI | https://platform.openai.com/api-keys | `[最小]` |
| Anthropic | https://console.anthropic.com/settings/keys | `[最小]`，做 failover |
| OpenRouter | https://openrouter.ai/keys | `[标准]`，一把 key 通 200+ 模型 |
| Nous Portal | https://portal.nousresearch.com | `[全开]`，Hermes 官方推荐 |

### 1.2 网络搜索后端（至少申请一家）

| 服务 | 申请地址 | 备注 |
| --- | --- | --- |
| Exa | https://dashboard.exa.ai/api-keys | 检索质量稳，`[最小]` |
| Tavily | https://app.tavily.com | `[标准]` |
| Firecrawl | https://www.firecrawl.dev/app/api-keys | 能 crawl 整站，`[标准]` |

> 三家都有免费层，具体额度以各自定价页为准。

### 1.3 IM bot token

| 平台 | 申请方式 | 文档链接 |
| --- | --- | --- |
| Telegram | 在 Telegram 搜 `@BotFather` → `/newbot` | `[最小]` |
| Discord | https://discord.com/developers/applications | `[标准]` |
| Slack | https://api.slack.com/apps | `[标准]` |
| Signal | 配对手机端 | `[全开]` |
| BlueBubbles | 自建桥（macOS Mac mini） | `[全开]`，能接 iMessage |

### 1.4 其他

| 服务 | 用途 | 申请地址 |
| --- | --- | --- |
| GitHub PAT | MCP github server | https://github.com/settings/tokens?type=beta |
| ElevenLabs | 高质量 TTS | https://elevenlabs.io/app/settings/api-keys `[标准]` |
| Deepgram | 实时 STT | https://console.deepgram.com `[标准]` |
| Google OAuth | Gmail/Calendar/Drive | https://console.cloud.google.com/apis/credentials `[标准]` |

---

## 2. OpenClaw 插件 checklist

> 包名来自 `vendor/openclaw/extensions/<dir>/package.json` 的 `name` 字段，用 `npm:` 前缀直装最稳（绕开 ClawHub ID 不确定的问题）。
> 命名规律：模型 provider 用 `-provider`、工具/搜索用 `-plugin`、IM 渠道一般无后缀、TTS 用 `-speech`。
> 如果 `npm:` 失败，可以试 `openclaw plugins search <keyword>` 找 ClawHub 上的对应 ID。

### 2.1 模型 provider

```bash
[ ] openclaw plugins install npm:@openclaw/openai-provider       # [最小]
[ ] openclaw plugins install npm:@openclaw/anthropic-provider    # [最小]
[ ] openclaw plugins install npm:@openclaw/openrouter-provider   # [标准]
[ ] openclaw plugins install npm:@openclaw/google-plugin         # [标准] Gemini
[ ] openclaw plugins install npm:@openclaw/deepseek-provider     # [全开]
[ ] openclaw plugins install npm:@openclaw/qwen-provider         # [全开]
[ ] openclaw plugins install npm:@openclaw/kimi-provider         # [全开] (源码目录是 kimi-coding)
```

### 2.2 网络搜索 / 抓取

```bash
[ ] openclaw plugins install npm:@openclaw/exa-plugin            # [最小]
[ ] openclaw plugins install npm:@openclaw/tavily-plugin         # [标准]
[ ] openclaw plugins install npm:@openclaw/firecrawl-plugin      # [标准]
[ ] openclaw plugins install npm:@openclaw/perplexity-plugin     # [全开]
[ ] openclaw plugins install npm:@openclaw/searxng-plugin        # [全开] 自部署
[ ] openclaw plugins install npm:@openclaw/duckduckgo-plugin     # [全开] 免 key
[ ] openclaw plugins install npm:@openclaw/brave-plugin          # [全开]
```

### 2.3 浏览器 / 网页

```bash
[ ] openclaw plugins install npm:@openclaw/browser-plugin        # [最小] Live Canvas 基石
```

### 2.4 IM 渠道（每个都要配 token）

```bash
[ ] openclaw plugins install npm:@openclaw/telegram              # [最小]
[ ] openclaw plugins install npm:@openclaw/discord               # [标准]
[ ] openclaw plugins install npm:@openclaw/slack                 # [标准]
[ ] openclaw plugins install npm:@openclaw/signal                # [标准]
[ ] openclaw plugins install npm:@openclaw/bluebubbles           # [标准] iMessage 桥
[ ] openclaw plugins install npm:@openclaw/imessage              # [标准] 直连 macOS Messages
[ ] openclaw plugins install npm:@openclaw/feishu                # [全开]
[ ] openclaw plugins install npm:@openclaw/qqbot                 # [全开]
[ ] openclaw plugins install npm:@openclaw/line                  # [全开]
[ ] openclaw plugins install npm:@openclaw/matrix                # [全开]
```

> macOS App（菜单栏 + Voice Wake + Canvas + 麦克风权限）单独装：去 https://openclaw.ai 下 `OpenClaw.app`。**只有签名版**才能让权限在每次重启后保留。

### 2.5 语音

```bash
[ ] openclaw plugins install npm:@openclaw/elevenlabs-speech     # [标准] 高质量 TTS
[ ] openclaw plugins install npm:@openclaw/deepgram-provider     # [标准] 实时 STT
[ ] openclaw plugins install npm:@openclaw/azure-speech          # [全开] 备选 STT/TTS
```

### 2.6 记忆 / 知识库

```bash
[ ] openclaw plugins install npm:@openclaw/memory-lancedb        # [标准] 本地向量库
[ ] openclaw plugins install npm:@openclaw/memory-wiki           # [全开] 人物/项目 wiki
```

### 2.7 创作（图片/视频/音频）

```bash
[ ] openclaw plugins install npm:@openclaw/fal-provider          # [全开] 图像 / 视频
[ ] openclaw plugins install npm:@openclaw/comfy-provider        # [全开] 本地 ComfyUI
[ ] openclaw plugins install npm:@openclaw/runway-provider       # [全开] 视频
[ ] openclaw plugins install npm:@openclaw/image-generation-core # [全开]
```

### 2.8 协议 / agent 互联

```bash
[ ] openclaw plugins install npm:@openclaw/acpx                  # [全开] Agent Client Protocol
[ ] openclaw plugins install npm:@openclaw/codex                 # [全开] 让 Codex 当 sub-agent
[ ] openclaw plugins install npm:@openclaw/opencode-provider     # [全开]
```

### 2.9 迁移 / 工具类

```bash
[ ] openclaw plugins install npm:@openclaw/migrate-claude        # [全开] 从 Claude 迁配置
[ ] openclaw plugins install npm:@openclaw/migrate-hermes        # [全开] 从 Hermes 迁配置
[ ] openclaw plugins install npm:@openclaw/skill-workshop        # [全开] 创作 skill 用
```

### 2.10 内置 skills（不用装，开箱即用）

`vendor/openclaw/skills/` 已经带的：
- `mcporter` — MCP 直调 CLI（自动 `npx` 拉）
- `peekaboo` — macOS 截屏 + 视觉

---

## 3. Hermes Agent checklist

### 3.1 安装就有的（`./setup-hermes.sh` 默认装 `.[all]`）

下面这些**只缺 API key**，extra 已经在 venv 里：

| Extra | 需要的配置 | 等级 |
| --- | --- | --- |
| messaging | Telegram/Discord/Slack token | `[最小]` |
| voice | 无（faster-whisper 离线） | `[标准]` |
| mcp | 无 | `[最小]` |
| honcho | `HONCHO_API_KEY`（可选托管） | `[标准]` |
| google | Google OAuth credentials.json | `[标准]` |
| web | 无（FastAPI dashboard） | `[标准]` |
| dingtalk / feishu | 各自 app key | `[全开]` |
| tts-premium | `ELEVENLABS_API_KEY` | `[标准]` |
| bedrock / mistral | AWS / Mistral key | `[全开]` |

> macOS 上 `.[all]` 会**自动跳过 `[matrix]`** —— pyproject.toml 用 `; sys_platform == 'linux'` 标条件依赖（注释里说 `python-olm` 在新 Clang 上炸）。需要 Matrix 的话只能去 Linux/WSL。

### 3.2 跑配置向导

```bash
[ ] hermes setup            # 走完整向导，配 LLM / 人格 / 工作目录
[ ] hermes tools            # 选搜索后端（Exa/Tavily/Firecrawl/Parallel）+ 启用各工具
[ ] hermes model            # 切默认模型
[ ] hermes gateway setup    # 配 messaging（如果要远程聊）
[ ] hermes gateway install  # 装成 launchd 服务（messaging + cron 守护）
```

### 3.3 可选 skills（按需装）

源码 `vendor/hermes-agent/optional-skills/` 全在那里。

```bash
# MCP 工具链
[ ] hermes skills install official/mcp/mcporter            # [最小] 跟 OpenClaw 一致
[ ] hermes skills install official/mcp/fastmcp             # [全开] 用 Python 写 MCP server

# 研究 / 资料
[ ] hermes skills install official/research/parallel-cli   # [标准]
[ ] hermes skills install official/research/gitnexus-explorer  # [标准] 大 repo 漫游
[ ] hermes skills install official/research/qmd            # [全开] Quarto 文档

# 生产力
[ ] hermes skills install official/productivity/linear     # [标准]
[ ] hermes skills install official/productivity/siyuan     # [全开] 思源笔记

# 邮件
[ ] hermes skills install official/email/agentmail         # [标准]

# 创意
[ ] hermes skills install official/creative/blender-mcp    # [全开]

# Web 开发
[ ] hermes skills install official/web-development/page-agent  # [全开]
```

### 3.4 终端后端（`hermes tools` 里切）

| 后端 | 用途 | 是否需要额外装 |
| --- | --- | --- |
| local | 直接在 macOS 上跑 | `[最小]` 默认 |
| docker | 隔离沙箱 | `[标准]` Docker Desktop 起着即可 |
| ssh | 远程主机 | `[标准]` 无需额外包 |
| modal | serverless 持久化 | `[全开]` `pip install -e ".[modal]"` |
| daytona | serverless 持久化 | `[全开]` `pip install -e ".[daytona]"` |
| vercel | serverless 沙箱 | `[全开]` `pip install -e ".[vercel]"` |
| singularity | HPC 用 | `[全开]`（Hermes README 提到，配置以官方 docs 为准） |

---

## 4. 两边共用的 MCP server checklist

**OpenClaw 写法**：`openclaw mcp set <name> '<json>'`，参数是单个 JSON 字符串（语法见 `vendor/openclaw/docs/cli/mcp.md:379`）。例：

```bash
openclaw mcp set context7 '{"command":"npx","args":["-y","@upstash/context7-mcp"]}'
openclaw mcp set docs     '{"url":"https://mcp.example.com","transport":"streamable-http"}'
```

**Hermes 写法**：编辑 `~/.hermes/config.yaml` 的 `mcp_servers:` 块（YAML，子键 `command`/`args`/`env`/`url`/`headers`）。

```bash
[ ] filesystem            # [最小] 受控文件读写
    npx -y @modelcontextprotocol/server-filesystem <path>

[ ] github                # [最小] repo / issue / PR
    npx -y @modelcontextprotocol/server-github
    # 需要 GITHUB_PERSONAL_ACCESS_TOKEN

[ ] context7              # [最小] 拉最新版库文档（Vercel/React/Next 等）
    npx -y @upstash/context7-mcp

[ ] memory                # [标准] 跨会话知识图
    npx -y @modelcontextprotocol/server-memory

[ ] sequential-thinking   # [标准] 显式 think 工具，提升复杂推理稳定性
    npx -y @modelcontextprotocol/server-sequential-thinking

[ ] playwright            # [标准] 真浏览器自动化
    npx -y @playwright/mcp@latest

[ ] sqlite                # [全开] 临时数据集分析
    npx -y @modelcontextprotocol/server-sqlite --db <path>

[ ] notion                # [全开] 用 Notion 时装；走 OAuth
    # Hosted MCP，详见 notion.so/help/mcp
[ ] linear                # [全开] 用 Linear 时装；走 OAuth
    # Hosted MCP，详见 linear.app/docs/mcp
[ ] slack                 # [全开] Slack 工作区操作（不止收发消息）
[ ] gmail / gcalendar     # [全开] Google MCP，走 OAuth
```

> ⚠ **同一个有状态远程 MCP（如 Linear 写操作）不要两边都连**——会互相打架。无状态的（filesystem/github/context7）随便。

---

## 5. 验证：装完跑这套确认

### OpenClaw

```bash
openclaw doctor                        # 体检，必跑
openclaw plugins list                  # 确认上面的插件都加载了
openclaw mcp list                      # 看 MCP 注册项
openclaw agent --message "今天东京天气怎么样？给我源链接" --thinking high
# ↑ 同时检验：模型 + 搜索 + 浏览器
```

### Hermes

```bash
hermes doctor                          # 体检
hermes config show                     # 看现行配置（也可 hermes config get <key>）
hermes                                 # 进 TUI
> /skills                              # 看 skills 加载情况
> /model                               # 看当前模型
> 今天东京天气怎么样？给我源链接
```

---

## 6. 三档配方对应的最小命令包

> **想偷懒？** 直接跑配套脚本：
> ```bash
> bash docs/setup-fullstack.sh min   # 或 std / full
> ```
> 脚本按 stage 逐项问 Y/n，不强制装、不自动填 API key（需要 key 的步骤会暂停打印申请链接）。下面命令包是给你想手动来一遍时对照的。

### `[最小]` 配方

```bash
# OpenClaw
fnm use 24 && npm install -g openclaw@latest
openclaw onboard --install-daemon
openclaw plugins install npm:@openclaw/openai-provider
openclaw plugins install npm:@openclaw/anthropic-provider
openclaw plugins install npm:@openclaw/exa-plugin
openclaw plugins install npm:@openclaw/browser-plugin
openclaw plugins install npm:@openclaw/telegram
openclaw mcp set filesystem '{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","'"$HOME"'"]}'
openclaw mcp set github     '{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}'
openclaw mcp set context7   '{"command":"npx","args":["-y","@upstash/context7-mcp"]}'

# Hermes（vendor 源码模式）
cd vendor/hermes-agent && ./setup-hermes.sh
source ~/.zshrc
hermes setup
hermes tools     # 选 Exa
hermes skills install official/mcp/mcporter
# 然后编辑 ~/.hermes/config.yaml 加 filesystem / github / context7 MCP
```

### `[标准]` 配方

在最小基础上：

```bash
# OpenClaw
openclaw plugins install npm:@openclaw/discord
openclaw plugins install npm:@openclaw/slack
openclaw plugins install npm:@openclaw/bluebubbles
openclaw plugins install npm:@openclaw/elevenlabs-speech
openclaw plugins install npm:@openclaw/deepgram-provider
openclaw plugins install npm:@openclaw/memory-lancedb
openclaw plugins install npm:@openclaw/google-plugin
# 装 OpenClaw.app（macOS 菜单栏 + 麦克风）

# Hermes
hermes skills install official/research/parallel-cli
hermes skills install official/research/gitnexus-explorer
hermes skills install official/productivity/linear
hermes skills install official/email/agentmail
# 编辑 config.yaml 加 memory + sequential-thinking + playwright MCP
```

### `[全开]` 配方

在标准基础上：把 §2.7 创作类、§2.8 协议类、§3.4 serverless 后端、§4 全部 MCP 全开。

---

## 7. 个人观点

- **先跑 `[最小]` 配方至少 3 天**再决定要不要升级。多数人 80% 时间在用网搜 + 浏览器 + 一个 IM，剩下的功能装了也吃灰。
- 同一把 LLM/Exa key 两边复用没问题，**但不要把同一个 Telegram/Discord bot token 同时挂给两边**——只会有一个稳定收消息（详见 [`docs/openclaw-getting-started.md`](./openclaw-getting-started.md) 的冲突分析）。
- MCP 装多了会拖慢 agent 启动（每个 stdio server 都要 spawn 一次 npx）。**经验值：单端常驻 MCP 控制在 5-8 个**，更多的可以放进 mcporter 按需调。
- 国内 IM（QQ/微信/飞书/钉钉）插件大多依赖逆向桥接，**大陆网络环境下不一定稳定**，落地前先在测试群里跑 `doctor`。
- macOS App + Voice Wake 的体验加分明显，但需要给一堆系统权限（麦克风/辅助功能/屏幕录制），介意权限弹窗就跳过。

---

## 8. 接下来

- OpenClaw 插件清单官方搜索：`openclaw plugins search "<keyword>"`
- Hermes optional skills 索引：`vendor/hermes-agent/website/docs/reference/optional-skills-catalog.md`
- ClawHub（OpenClaw 插件市场）：https://clawhub.ai
- Skills Hub（Hermes 兼容）：https://agentskills.io
- MCP server 公开目录：https://mcp.so 、 https://mcpfinder.dev
