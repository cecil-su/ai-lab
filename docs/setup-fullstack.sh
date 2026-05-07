#!/usr/bin/env bash
# ============================================================================
# OpenClaw + Hermes Agent 一键体验脚本（macOS / Linux）
# ============================================================================
# 用法:
#   bash docs/setup-fullstack.sh [min|std|full]
#
# 默认 profile = min。脚本按 stage 逐项问 Y/n，不会强制装。
# 不会自动填 API key、不会自动跑 onboard 向导。需要 key/OAuth 的步骤会暂停
# 并打印申请链接。
#
# 插件 ID 来源: vendor/openclaw/extensions/<dir>/package.json 的 name 字段
# (用 npm: 前缀直装，绕开 ClawHub ID 不确定的问题)
# ============================================================================

set -euo pipefail

PROFILE="${1:-min}"
case "$PROFILE" in
  min|std|full) ;;
  *) echo "用法: $0 [min|std|full]"; exit 1 ;;
esac

# ---------- 颜色 ----------
G='\033[0;32m'; Y='\033[0;33m'; C='\033[0;36m'; R='\033[0;31m'; D='\033[0m'
say()  { echo -e "${C}→${D} $*"; }
ok()   { echo -e "${G}✓${D} $*"; }
warn() { echo -e "${Y}⚠${D} $*"; }
err()  { echo -e "${R}✗${D} $*"; }
hr()   { echo; echo -e "${C}════════════════════════════════════════════════${D}"; }

# 默认 Y 的确认
ask() {
  local prompt="$1"
  read -r -p "$(echo -e "${Y}?${D} ${prompt} [Y/n] ")" reply
  [[ -z "$reply" || "$reply" =~ ^[Yy] ]]
}

# 装一个 OpenClaw 插件（参数: 不带 @openclaw/ 前缀的包名后半段）
oc_install() {
  local pkg="$1"
  if openclaw plugins install "npm:@openclaw/$pkg" 2>/dev/null; then
    ok "@openclaw/$pkg 安装成功"
  else
    warn "@openclaw/$pkg 安装失败（可手动: openclaw plugins search $pkg）"
  fi
}

# 注册一个 OpenClaw MCP server
# 真实语法: openclaw mcp set <name> '<json>' （单 JSON 字符串）
oc_mcp_set() {
  local name="$1" json="$2"
  if openclaw mcp set "$name" "$json" 2>/dev/null; then
    ok "MCP $name 已注册"
  else
    warn "MCP $name 注册失败"
  fi
}

# 装一个 Hermes skill
hm_skill() {
  local id="$1"
  if hermes skills install "$id" 2>/dev/null; then
    ok "skill $id 已就绪"
  else
    warn "skill $id 安装失败（先确认 hermes setup 跑过、有 GITHUB_TOKEN）"
  fi
}

# ============================================================================
hr
echo -e "${C}OpenClaw + Hermes 体验脚本${D}  profile=${G}${PROFILE}${D}"
hr

# ---------- Stage 0: 环境 ----------
hr
say "Stage 0 / 环境检查"

if ! command -v node >/dev/null 2>&1; then
  err "Node 未安装。建议: brew install fnm && fnm install 24 && fnm use 24"; exit 1
fi
NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+)\..*/\1/')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  err "Node $NODE_MAJOR 太旧（需 22.14+，推荐 24）"; exit 1
fi
ok "node $(node -v)"

for bin in npm git curl; do
  if command -v "$bin" >/dev/null 2>&1; then
    ok "$bin ok"
  else
    err "需要 $bin"; exit 1
  fi
done

# ---------- Stage 1: OpenClaw ----------
hr
say "Stage 1 / OpenClaw 安装与插件"

if ask "全局安装/升级 openclaw?"; then
  npm install -g openclaw@latest
  ok "openclaw $(openclaw --version 2>/dev/null || echo '已就绪')"
fi

if ! command -v openclaw >/dev/null 2>&1; then
  warn "openclaw 不在 PATH，跳过 Stage 1 后续步骤"
else
  if ask "现在跑 openclaw onboard --install-daemon? (会启动交互向导，需要 LLM API key)"; then
    echo
    echo "API key 申请链接:"
    echo "  OpenAI:    https://platform.openai.com/api-keys"
    echo "  Anthropic: https://console.anthropic.com/settings/keys"
    echo
    openclaw onboard --install-daemon || warn "onboard 中断，可后面手动重跑"
  fi

  # --- 模型 provider ---
  if ask "装 OpenClaw 模型 provider 插件 (openai + anthropic)?"; then
    oc_install "openai-provider"
    oc_install "anthropic-provider"
    [[ "$PROFILE" != "min" ]] && oc_install "openrouter-provider"
    [[ "$PROFILE" != "min" ]] && oc_install "google-plugin"
    if [[ "$PROFILE" == "full" ]]; then
      oc_install "deepseek-provider"
      oc_install "qwen-provider"
      oc_install "kimi-provider"
    fi
  fi

  # --- 网络搜索 ---
  if ask "装搜索后端 (Exa)?"; then
    echo "  Exa key: https://dashboard.exa.ai/api-keys"
    oc_install "exa-plugin"
    if [[ "$PROFILE" != "min" ]]; then
      oc_install "tavily-plugin"
      oc_install "firecrawl-plugin"
    fi
    [[ "$PROFILE" == "full" ]] && oc_install "perplexity-plugin"
    [[ "$PROFILE" == "full" ]] && oc_install "searxng-plugin"
  fi

  # --- 浏览器 ---
  if ask "装 browser 插件 (Live Canvas / 网页操控基石)?"; then
    oc_install "browser-plugin"
  fi

  # --- IM 渠道 ---
  if ask "装 Telegram 渠道 (最快入门)?"; then
    echo "  在 Telegram 搜 @BotFather → /newbot 拿 token"
    oc_install "telegram"
  fi
  if [[ "$PROFILE" != "min" ]] && ask "装更多 IM 渠道 (Discord/Slack/Signal/iMessage)?"; then
    oc_install "discord"
    oc_install "slack"
    oc_install "signal"
    oc_install "bluebubbles"
    oc_install "imessage"
  fi
  if [[ "$PROFILE" == "full" ]] && ask "装国内 IM 渠道 (Feishu/QQ/LINE/Matrix)?"; then
    oc_install "feishu"
    oc_install "qqbot"
    oc_install "line"
    oc_install "matrix"
  fi

  # --- 语音 ---
  if [[ "$PROFILE" != "min" ]] && ask "装语音插件 (ElevenLabs TTS + Deepgram STT)?"; then
    echo "  ElevenLabs: https://elevenlabs.io/app/settings/api-keys"
    echo "  Deepgram:   https://console.deepgram.com"
    oc_install "elevenlabs-speech"
    oc_install "deepgram-provider"
    [[ "$PROFILE" == "full" ]] && oc_install "azure-speech"
  fi

  # --- 记忆 ---
  if [[ "$PROFILE" != "min" ]] && ask "装本地向量记忆 (memory-lancedb)?"; then
    oc_install "memory-lancedb"
  fi

  # --- 创作 / 协议 ---
  if [[ "$PROFILE" == "full" ]] && ask "装创作类插件 (fal/comfy/runway)?"; then
    oc_install "fal-provider"
    oc_install "comfy-provider"
    oc_install "runway-provider"
  fi
  if [[ "$PROFILE" == "full" ]] && ask "装 agent 互联协议插件 (acpx + codex)?"; then
    oc_install "acpx"
    oc_install "codex"
  fi

  # --- MCP server 注册 ---
  if ask "给 OpenClaw 注册基础 MCP server (filesystem + github + context7)?"; then
    fs_json=$(printf '{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","%s"]}' "$HOME")
    oc_mcp_set "filesystem" "$fs_json"
    oc_mcp_set "github" '{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}'
    echo "  ↑ github 还需要在 OpenClaw 配置里加 GITHUB_PERSONAL_ACCESS_TOKEN env"
    oc_mcp_set "context7" '{"command":"npx","args":["-y","@upstash/context7-mcp"]}'

    if [[ "$PROFILE" != "min" ]]; then
      oc_mcp_set "memory" '{"command":"npx","args":["-y","@modelcontextprotocol/server-memory"]}'
      oc_mcp_set "sequential-thinking" '{"command":"npx","args":["-y","@modelcontextprotocol/server-sequential-thinking"]}'
      oc_mcp_set "playwright" '{"command":"npx","args":["-y","@playwright/mcp@latest"]}'
    fi
  fi

  if ask "重启 OpenClaw gateway 让插件生效?"; then
    openclaw gateway restart 2>/dev/null || warn "gateway 重启失败（手动: openclaw gateway restart）"
  fi
fi

# ---------- Stage 2: Hermes Agent ----------
hr
say "Stage 2 / Hermes Agent 安装"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_DIR="$REPO_ROOT/vendor/hermes-agent"

if [[ ! -d "$HERMES_DIR" ]]; then
  warn "未发现 vendor/hermes-agent；跳过 Hermes（如需，先 git clone 到 vendor/）"
else
  if [[ ! -d "$HERMES_DIR/venv" ]]; then
    if ask "现在跑 vendor/hermes-agent/setup-hermes.sh? (装 uv + venv + .[all])"; then
      ( cd "$HERMES_DIR" && ./setup-hermes.sh ) || warn "setup-hermes.sh 失败，看上面错误"
    fi
  else
    ok "Hermes venv 已存在: $HERMES_DIR/venv"
  fi

  # 重载 PATH（setup-hermes.sh 会写到 ~/.zshrc）
  export PATH="$HOME/.local/bin:$PATH"

  if command -v hermes >/dev/null 2>&1; then
    if ask "现在跑 hermes setup? (交互向导，配 LLM/人格/工作目录)"; then
      hermes setup || warn "setup 中断，可后面手动重跑"
    fi
    if ask "现在跑 hermes tools? (选搜索后端 + 启用各工具)"; then
      hermes tools || true
    fi

    # --- Hermes optional skills ---
    if ask "装 Hermes 可选 skills (按 profile)?"; then
      hm_skill "official/mcp/mcporter"
      if [[ "$PROFILE" != "min" ]]; then
        hm_skill "official/research/parallel-cli"
        hm_skill "official/research/gitnexus-explorer"
        hm_skill "official/productivity/linear"
        hm_skill "official/email/agentmail"
      fi
      if [[ "$PROFILE" == "full" ]]; then
        hm_skill "official/mcp/fastmcp"
        hm_skill "official/research/qmd"
        hm_skill "official/productivity/siyuan"
        hm_skill "official/creative/blender-mcp"
        hm_skill "official/web-development/page-agent"
      fi
    fi

    # --- 生成 Hermes MCP 配置片段 ---
    if ask "生成 Hermes MCP 配置片段到 ~/.hermes/config.yaml.mcp-block?"; then
      mkdir -p "$HOME/.hermes"
      OUT="$HOME/.hermes/config.yaml.mcp-block"
      cat > "$OUT" <<EOF
# 把下面整段 mcp_servers 块合并进 ~/.hermes/config.yaml
# (如果已有同名 key, 手动合并子项)
mcp_servers:
  filesystem:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "$HOME"]
  github:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "<填你的 PAT, 或留空用 gh auth>"
  context7:
    command: "npx"
    args: ["-y", "@upstash/context7-mcp"]
EOF
      if [[ "$PROFILE" != "min" ]]; then
        cat >> "$OUT" <<EOF
  memory:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-memory"]
  sequential-thinking:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"]
  playwright:
    command: "npx"
    args: ["-y", "@playwright/mcp@latest"]
EOF
      fi
      if [[ "$PROFILE" == "full" ]]; then
        cat >> "$OUT" <<EOF
  sqlite:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-sqlite", "--db", "$HOME/.hermes/scratch.db"]
EOF
      fi
      ok "已写入 $OUT —— 自行合并到 ~/.hermes/config.yaml"
    fi
  else
    warn "hermes 不在 PATH，跳过 Hermes 后续步骤"
  fi
fi

# ---------- Stage 3: 验证 ----------
hr
say "Stage 3 / 验证"

if command -v openclaw >/dev/null 2>&1; then
  if ask "跑 openclaw doctor?"; then
    openclaw doctor || true
  fi
else
  warn "openclaw 不在 PATH，跳过 doctor"
fi
if command -v hermes >/dev/null 2>&1; then
  if ask "跑 hermes doctor?"; then
    hermes doctor || true
  fi
else
  warn "hermes 不在 PATH，跳过 doctor"
fi

# ---------- 完成 ----------
hr
ok "脚本结束。下一步建议:"
echo "  1. openclaw plugins list                  # 看插件加载情况"
echo "  2. openclaw agent --message \"今天东京天气?\" --thinking high"
echo "  3. hermes                                 # 进 TUI 试一句搜索"
echo "  4. 把 ~/.hermes/config.yaml.mcp-block 合并进 ~/.hermes/config.yaml"
echo
echo "对应文档: docs/openclaw-hermes-fullstack.md"
hr
