# leeguooooo/wechat-skill macOS 复刻实施计划

| 字段 | 内容 |
|---|---|
| 创建日期 | 2026-05-06 |
| 状态 | 待启动（M1 未开始）|
| 路线 | B（macOS 上自己实现，跳过最深 RE，复用现成开源 key 提取） |
| 预估工期 | 6-8 周（业余每天 1-2 小时） |
| 主语言 | Python（M1-M3）→ 验证后视情况用 Rust 重写 M4-M5 |
| 代码位置 | `lab/wechat-mac/`（lab 性质实验，可丢弃） |
| 参考实现 | `vendor/wechat-skill/`（leeguooooo，闭源二进制 + 详细文档） |
| 对照实现 | `vendor/wechat-skills/`（huangdijia，113 行 pyautogui，发送层最简版本） |
| 关联项目 | `vendor/hermes-agent/`（NousResearch，AI agent 框架；M5 可能对齐其 bridge schema） |

---

## 0. 一句话目标

在自己的 Mac 上做一个**功能基本对齐 leeguooooo 的开源版本**：

- ✅ 能从命令行发文字消息
- ✅ 能查会话/联系人/历史/搜索
- ✅ 能监听新消息
- ✅ HTTP + SSE bridge 让 AI agent 调用
- ✅ 一份 SKILL.md 让 Claude Code 学会全部命令

**不做**：

- ❌ Qt slot signal 注入（深 RE，3-6 周成本，跳过；用键盘宏替代，接受 UI flash）
- ❌ 服务端 profile API 热更兜底（个人用，自己改 SHA 映射就行）
- ❌ Wechaty puppet-service gRPC 协议（M5 之后想做再说）
- ❌ 图片堆扫描 + CDN 回放（v2 再考虑，先支持文字）
- ❌ 远程驱动（orchestrate / tunnel）（v2 再说）
- ❌ Windows 兼容（不可能，机制差太远）

**成功标准**：

```bash
# 在 Mac 终端跑这条能成功发到我自己的"文件传输助手"
$ python -m wechat_mac send "hello" filehelper

# 跟 Claude Code 说这句话能跑通
> "查最近 5 个会话，给最近联系最多的那个人发一条早安"
```

---

## 0.5 前置条件清单（固化对话假设，跨会话续接必读）

启动 M1 之前**必须**满足以下条件，否则计划无效，需要重新讨论路线：

| # | 条件 | 检查方法 | 不满足怎么办 |
|---|---|---|---|
| 1 | Apple Silicon Mac (M1+) | `uname -m` 返回 `arm64` | Intel Mac 上偏移完全不同，重新规划路线（或换机） |
| 2 | macOS ≥ 14 (Sonoma) | `sw_vers -productVersion` | 12-13 上 entitlement / TCC 流程不同；最低实测目标 14 |
| 3 | WeChat 版本是 4.0.1.52 / 4.1.8 / 4.1.9 之一（**记录具体 build 号**） | `defaults read /Applications/WeChat.app/Contents/Info CFBundleVersion` | 其他版本要自己逆向偏移，工作量翻倍 |
| 4 | 能装 Xcode Command Line Tools | `xcode-select -p` 有输出 | 不能装就别开始 |
| 5 | Terminal.app（或 iTerm/你用的 shell）拿到 **Full Disk Access** 权限 | 见 §4.1.1 第 0 步 | 必装，否则读 sandbox 容器全部失败 |
| 6 | 有可丢弃的微信小号做测试 | — | 不要在主号上开始 |

**记录你的实际值到这里**（启动 M1 时填）：

```
arch:        ____
macOS:       ____
WeChat ver:  ____
WeChat build:____
dylib SHA:   ____
```

这一节比下面任何技术细节都重要——前置条件错了，下面整本都是浪费。

---

## 1. 架构总览

### 1.1 五层架构（从底到顶）

```
┌─────────────────────────────────────────────────────┐
│ L5: SKILL.md / 提示词                                │  M6
│     给 Claude Code 一份系统提示，约束行为             │
├─────────────────────────────────────────────────────┤
│ L4: 多 Surface 封装                                  │  M5
│     CLI (argparse) + HTTP+SSE Bridge (FastAPI)      │
├─────────────────────────────────────────────────────┤
│ L3: 业务能力                                         │  M2 + M4
│     - 查询: sessions / contacts / history / search   │
│     - 收消息: DB 文件 mtime 轮询 + 增量 SQL          │
│     - 发送: AppleScript / pyautogui                  │  M3
├─────────────────────────────────────────────────────┤
│ L2: 数据访问                                         │  M2
│     pysqlcipher3 用 32 字节 key 直接打开 .db         │
├─────────────────────────────────────────────────────┤
│ L1: Key 提取                                         │  M1
│     LLDB 断点 + 字符串 xref 静态定位偏移             │
└─────────────────────────────────────────────────────┘
                          ↓
                    WeChat.app (4.x)
                    ~/Library/Containers/...
```

### 1.2 数据流（三条主路径）

**发送路径**（最简）：

```
Claude Code → CLI/HTTP → AppleScript → WeChat UI → 真实发送
                                         ↑
                                   抢焦点 + 抢键盘
```

**查询路径**：

```
Claude Code → CLI/HTTP → pysqlcipher3.open(db, key)
                              ↓
                              SQL 查询本地解密后数据
                              ↓
                              JSON/YAML 返回
```

**监听路径**：

```
后台进程: watchdog 监听 .db mtime 变化
              ↓
           增量 SELECT * FROM message WHERE seq > last_seq
              ↓
           推 SSE / 写 stdout / 调 webhook
```

### 1.3 与 leeguooooo 的差异

| 维度 | leeguooooo | 本计划 | 差异原因 |
|---|---|---|---|
| Key 提取 | 自研 LLDB BP + 字符串 xref + dylib SHA→偏移服务端 | 复用现成开源工具 + 手动维护 SHA→偏移 JSON | 个人项目，不需要服务端 |
| 发送层 | Qt slot signal 注入，零 UI flash | AppleScript/pyautogui，**会抢焦点** | 跳过 3-6 周深 RE |
| 收消息 | C++ daemon Hook DB 写入函数，毫秒级实时 | Python watchdog 轮询 mtime + 增量 SQL，秒级延迟 | 简化实现 |
| 图片 | 堆扫描 + CDN 回放 | 不支持（v2） | 复杂度太高 |
| 鉴权 | 激活码 + Telegram bot | 无 | 个人用 |
| 多 surface | CLI + HTTP+SSE + Wechaty gRPC | CLI + HTTP+SSE | 暂不做 Wechaty |
| 远程驱动 | orchestrate + tunnel | 无 | 暂不做 |

### 1.4 跟「微信通信」三条路线辨析（重要：选错路线会浪费几周）

业界目前有三种跟微信通信的方式，**目标场景完全不同**，路线 B 选的是 ① ：

| | ① leeguooooo 路线（路线 B） | ② huangdijia 键盘宏 | ③ hermes-agent iLink Bot |
|---|---|---|---|
| **身份** | 你自己的微信号 | 你自己的微信号 | 一个独立 bot 账号（`xxx@im.bot`） |
| **路径** | LLDB hook 本地客户端 | macOS UI 键盘合成 | 腾讯**官方 iLink HTTP API** |
| **平台** | macOS arm64 | macOS | 任何能跑 Python 的 |
| **能用我账号给张三发消息** | ✅ | ✅ | ❌（bot 不是你） |
| **能收别人 @ 我** | ✅ | ❌ | ❌（@ 你 ≠ @ bot） |
| **能收普通群消息** | ✅ | ❌ | ❌（iLink 不投递） |
| **能查我的历史 / 联系人** | ✅ | ❌ | ❌（无 API） |
| **能让朋友主动来撩 bot** | ✅（间接） | ✅（间接） | ✅（这是 iLink 的本职） |
| **封号风险** | 中 | 中 | 几乎零（官方 API） |
| **对应文档** | `vendor/wechat-skill/SKILL.md` | `vendor/wechat-skills/skills/wechat/SKILL.md` | `vendor/hermes-agent/website/docs/user-guide/messaging/weixin.md` |

**关键判断**：

- 路线 B 的目标是「**控制我自己的微信账号**」 → 必须走 ①，② 是 ① 失败时的发送层降级（M3 fallback），③ **完全做不到这件事**
- 如果某天目标变成「做一个微信 AI 助手 bot 让朋友能主动来聊」 → 这种需求应该直接用 hermes-agent 的 iLink adapter，**不要用路线 B 凑合**
- 这两个目标混淆是新手最容易踩的坑（看 hermes-agent doc 第 15-23 行，它自己反复警告 "iLink bot 身份 ≠ 你的微信账号"）

---

## 2. 技术选型

### 2.1 语言：Python（M1-M3）→ 视情况 Rust

| 阶段 | 选择 | 理由 |
|---|---|---|
| M1-M3（验证） | Python 3.11+ | 起步快，LLDB Python API 原生支持，pysqlcipher3 + watchdog + AppleScript bridge 全是 Python |
| M4-M5（产品化） | 可选 Rust 重写 | 单二进制发布、性能更好、跟 leeguooooo 同栈方便对照学习；**只在 M3 跑通后再决定** |
| M6（SKILL.md） | Markdown | 同 leeguooooo |

**反例**：不要一上来就用 Rust。Rust 的 SQLCipher 绑定（`rusqlite` + `bundled-sqlcipher`）在 macOS 上编译链路比 Python 麻烦，会在 M2 拖时间。

### 2.2 关键依赖

```toml
# lab/wechat-mac/pyproject.toml 预期
[project.dependencies]
pysqlcipher3 = "^1.2"        # SQLCipher Python 绑定
pyautogui = "^0.9"           # 键盘宏（M3 备用方案）
pyperclip = "^1.8"           # 剪贴板
pyperclipimg = "^0.4"        # 图片剪贴板（v2 才用到）
watchdog = "^4.0"            # 文件 mtime 监听
fastapi = "^0.110"           # M5 HTTP bridge
uvicorn = "^0.27"            # FastAPI server
sse-starlette = "^2.0"       # SSE 支持
typer = "^0.9"               # CLI（比 argparse 漂亮）
rich = "^13.0"               # 终端输出
pyyaml = "^6.0"              # YAML 输出（agent 友好）
```

> ⚠️ `pysqlcipher3` 在 macOS arm64 上需要先 `brew install sqlcipher`，pip 安装时通过 `LDFLAGS` / `CPPFLAGS` 指向 brew 路径。**M2 先验证这一步能装通**，装不通就换 `sqlcipher3-binary`（预编译 wheel）。

### 2.3 LLDB 脚本

**LLDB 自带 Python 解释器**（`~/.lldbinit` 里 `command script import xxx.py`），M1 全程在 LLDB Python API 内做：

- `lldb.debugger.GetSelectedTarget()` — 拿到 attach 的 WeChat 进程
- `target.BreakpointCreateByName("sqlcipher_xxx")` — 下断点
- `target.BreakpointCreateByRegex("...")` — 字符串 xref 搜
- `frame.FindRegister("x1")` — 读 arm64 寄存器
- `process.ReadMemory(addr, 32)` — 读 32 字节 key

参考 Apple 官方 [LLDB Python API 文档](https://lldb.llvm.org/python_api.html)。

---

## 3. 项目结构

```
lab/wechat-mac/
├── pyproject.toml
├── README.md
├── .gitignore                       # 忽略 ~/.wx-mac/* 这种本地状态
├── src/
│   └── wechat_mac/
│       ├── __init__.py
│       ├── __main__.py              # python -m wechat_mac
│       ├── cli.py                   # typer CLI 入口
│       ├── config.py                # ~/.wx-mac/config.json 读写
│       ├── keystore.py              # 32 字节 key 持久化（chmod 600）
│       ├── lldb_extract.py          # M1: LLDB key 提取 (LLDB Python API 脚本)
│       ├── db.py                    # M2: pysqlcipher3 封装
│       ├── queries.py               # M2: sessions/contacts/history SQL
│       ├── send_applescript.py      # M3: AppleScript 发送
│       ├── send_pyautogui.py        # M3: pyautogui 发送（fallback）
│       ├── listen.py                # M4: watchdog + 增量 SQL
│       ├── bridge/                  # M5: FastAPI HTTP+SSE，schema 决策见 §4.5.4
│       │   ├── __init__.py
│       │   ├── app.py
│       │   ├── routes.py
│       │   └── sse.py
│       └── schemas/                 # SSE payload / API JSON schema
│           └── sse-v1.json
├── scripts/
│   ├── extract_key.sh               # M1 包装：xcode-select + DevToolsSecurity + lldb attach
│   ├── find_db_paths.py             # M2 工具：在 ~/Library/Containers 里找 .db 文件
│   └── inspect_schema.py            # M2 工具：导出 .db 的 sqlite_master 看 schema
├── tests/
│   ├── test_db.py                   # M2 单测：fixture .db → 查询返回正确
│   ├── test_send_applescript.py     # M3 e2e：发到 filehelper 后查 DB 确认
│   └── test_listen.py               # M4 单测：mtime 触发增量
├── docs/
│   ├── architecture.md              # 详细架构图
│   ├── lldb-walkthrough.md          # M1 手动 LLDB 操作 step-by-step
│   ├── db-schema.md                 # M2 摸清的 WeChat DB 表结构
│   └── send-comparison.md           # M3 AppleScript vs pyautogui 实测对比
├── SKILL.md                         # M6 给 Claude Code
└── .claude-plugin/                  # M6 marketplace 注册（可选）
    ├── plugin.json
    └── marketplace.json

# 本地状态（不入 git）
~/.wx-mac/
├── config.json                      # WeChat 版本、build、dylib SHA
├── key.hex                          # 32 字节 SQLCipher key（mode 0600）
└── offsets.json                     # dylib SHA → 函数偏移映射（手动维护）
```

> **AI Lab 项目层面**：按 CLAUDE.md 的目录决策树，这是个实验性项目 → 进 `lab/`，`"private": true`。**不要进 pnpm workspace 的 `tools/*`**，等 M5 跑通且想继续维护时再 graduate 到 `tools/wechat-mac/` 并去掉 `private`。

---

## 4. 详细里程碑

### M1：SQLCipher Key 提取（目标 2-3 周业余时间）

> **工期警告**：原文档写 1 周是按"有逆向经验、全职"估的。**业余每天 1-2 小时、首次做 macOS 逆向**，现实工期是 2-3 周。不要按 1 周对自己施压，会做出错的取舍。

**目标**：能从命令行跑一条命令，输出 32 字节十六进制 key，并存到 `~/.wx-mac/key.hex`。

#### 4.1.0 ⭐ 第 0 步：先白嫖（半天，决定后续走 §4.1.2 还是 §4.1.5）

路线 B 的核心承诺是**复用现成 key 提取**——所以先做这个 spike，再决定要不要自己逆。

```bash
# 候选 1: PyWxDump（看是否有 macOS 实验分支）
git clone https://github.com/xaoyaoo/PyWxDump vendor/pywxdump
ls vendor/pywxdump/pywxdump/  # 看是否有 mac 相关代码

# 候选 2: 搜 GitHub 的 macOS 微信 key dumper
# 关键词: "wechat mac sqlcipher key dump arm64"

# 候选 3: 已经 clone 在 vendor/ 的 leeguooooo/wechat-skill
# 注意：它的二进制需要激活码，但 wechat init 这一步白嫖也能跑
#       具体见 docs/why-init.md（已读过）—— 看能否只跑 init 不发消息
```

**判断标准**（spike 输出）：

- ✅ 能从某个开源项目拿到 32 字节正确 key（用 `sqlcipher` CLI 验证打开 .db 不报错） → **跳过 §4.1.2-4.1.4，直接进 M2**。M1 里只剩"封装 + key 持久化 + dylib SHA 检测"这点工程活
- ⚠️ 有项目但只支持 macOS 上某个特定 build，跟你不一样 → 看能否拿来当**学习样板**（参考它怎么找偏移），自己照葫芦画瓢做 §4.1.2
- ❌ 完全没有可用方案 → 自逆，走 §4.1.2-4.1.4，**工期翻倍**

> ⚠️ **不要把 §4.1.0 一笔带过**。半天的 spike 决定了 M1 是 1 周还是 1 个月。如果自己逆 SQLCipher 入口，业余时间至少 2 周打底（找候选函数 + 字符串 xref + 反汇编 + 验证）。

#### 4.1.1 环境准备（半天）

```bash
# 0) ⭐ 关键：给 Terminal.app（或 iTerm/Warp/你用的 shell）授予 Full Disk Access
#    System Settings → Privacy & Security → Full Disk Access → +
#    没这个权限的话，读 ~/Library/Containers/com.tencent.xinWeChat/...
#    会 silent permission denied，M2 的 inspect_schema、M4 的 watchdog 全部失败
#    且报错信息很迷惑（PermissionError 但路径是对的）
#    给完权限后必须**重启 Terminal**（GUI 进程不会动态拿到新 TCC 授权）

# 1) 装 Xcode Command Line Tools
xcode-select --install

# 2) 验证 LLDB 可用
lldb --version  # 应输出 lldb-1500+ (macOS Sonoma) / 1600+ (Sequoia)

# 3) 开 macOS Developer Mode（一次性，要求 sudo + 重启）
sudo DevToolsSecurity -enable

# 4) 给 WeChat 主二进制加 get-task-allow entitlement
cat > /tmp/wechat-debug.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.get-task-allow</key>
  <true/>
</dict>
</plist>
EOF

sudo codesign --force --sign - --entitlements /tmp/wechat-debug.plist \
  /Applications/WeChat.app/Contents/MacOS/WeChat

# 5) 验证签名生效
codesign -d --entitlements - /Applications/WeChat.app/Contents/MacOS/WeChat
# 应能看到 com.apple.security.get-task-allow = true
```

> ⚠️ 第 4 步**只动主二进制**，不碰 wechat.dylib。WeChat 自动更新后会被覆盖，需要重做这一步。把它写成 `scripts/codesign_wechat.sh`。

> ⚠️ 第 4 步会让 WeChat 失去 Apple 官方签名校验。后果：理论上可能被 Gatekeeper 提示"已损坏"。实测如果你之前已经允许过 WeChat 启动，是不会触发的。**第一次 codesign 完先手动开一次 WeChat**，确认能正常登录再继续。

#### 4.1.2 摸清 WeChat 内部布局（1-2 天）

**目标**：找到 SQLCipher key 写入内存的瞬间。

```bash
# 1) 找到 wechat.dylib 路径
WECHAT_DYLIB=$(find /Applications/WeChat.app -name "wechat.dylib" 2>/dev/null)
echo $WECHAT_DYLIB
# 一般在 /Applications/WeChat.app/Contents/MacOS/wechat.dylib 或 .../Frameworks/...

# 2) 算 SHA-256 + CFBundleVersion，记到 ~/.wx-mac/config.json
shasum -a 256 "$WECHAT_DYLIB"
defaults read /Applications/WeChat.app/Contents/Info CFBundleVersion
defaults read /Applications/WeChat.app/Contents/Info CFBundleShortVersionString

# 3) 看 dylib 里有什么 SQLCipher 相关字符串
nm -gU "$WECHAT_DYLIB" | grep -iE 'sqlite|cipher|key' | head -30
strings "$WECHAT_DYLIB" | grep -iE 'sqlite|cipher' | head -30
```

**关键候选函数**（按可能性排序）：

| 候选 | 调用语义 | arm64 寄存器约定（**仅参考！必须实测**） |
|---|---|---|
| `sqlite3_key_v2(db, zDbName, pKey, nKey)` | nKey=32 时是 raw key | x0=db, x1=zDbName, x2=pKey, w3=nKey |
| `sqlite3_key(db, pKey, nKey)` | 老版本 SQLCipher | x0=db, x1=pKey, w2=nKey |
| `sqlcipher_codec_ctx_set_pass` | 内部函数 | 内部 ABI（编译器随便分配） |
| `sqlite3CodecAttach` | SQLCipher 内部 | 内部 ABI（编译器随便分配） |

> ⚠️ **寄存器约定必须在 §4.1.3 手动 LLDB 时实测，不能照搬上表**。原因：
> - WeChat 是 C++ 静态链接 SQLCipher，编译器**有权 inline / 重排寄存器**
> - 如果走字符串 xref 找到的是**内部函数**（`sqlite3CodecAttach` 等），它没有 stable C ABI
> - 实测方法：BP 命中后 `register read x0 x1 x2 x3 w2 w3`，找哪个寄存器**指向 32 字节看起来像随机的内存**就是 key 指针
> - 实测发现的真实 ABI 写进 `~/.wx-mac/offsets.json` 的 `key_register` 字段

**找不到符号时**用**字符串 xref**：

1. SQLCipher 源码里有特征字符串 `"PRAGMA key="` / `"sqlite3_key"` / `"unsupported file format"`
2. 在 dylib 里找这些字符串的地址
3. 用 `otool -tV` 反汇编，搜引用这些字符串的函数（`adrp` + `add` 模式）
4. 那个函数大概率就是 SQLCipher 的入口

```bash
# 用 IDA / Hopper / Binary Ninja（任选一个，Hopper 个人版便宜）
# 或者用免费的 radare2:
brew install radare2
r2 -A "$WECHAT_DYLIB"
> izz~PRAGMA key   # 列出包含字符串的位置
> axt @ <addr>     # 看哪些代码引用这个字符串
```

**记录所有发现到** `lab/wechat-mac/docs/lldb-walkthrough.md`，并写入 `~/.wx-mac/offsets.json`：

```json
{
  "<dylib-sha256>": {
    "wechat_version": "4.1.9",
    "build": "268575",
    "sqlcipher_init_func_offset": "0x12345",
    "key_register": "x2",
    "key_length_register": "w3"
  }
}
```

#### 4.1.3 LLDB 手动验证（1 天）

```bash
# 1) 关掉 WeChat
osascript -e 'tell application "WeChat" to quit'

# 2) 启动 WeChat 但暂停在 main，等 LLDB 接管
lldb /Applications/WeChat.app/Contents/MacOS/WeChat
(lldb) settings set target.process.follow-fork-mode child
(lldb) process launch --stop-at-entry

# 3) 在你确定的 SQLCipher init 函数下断点
(lldb) breakpoint set --address 0x100000000+0x12345  # 用上面查到的偏移
# 或用名字（如果符号没 strip）：
(lldb) breakpoint set --name sqlite3_key_v2

# 4) 加条件：只在 key 长度 == 32 时停
(lldb) breakpoint modify --condition '$w3 == 32' 1

# 5) 继续运行，扫码登录
(lldb) continue
# 等微信扫码 / 输密码 / 自动登录
# 断点会命中

# 6) 命中后读 32 字节 key
(lldb) memory read --size 1 --format x --count 32 $x2
# 输出 32 个十六进制字节就是 key

# 7) 立刻 detach，让 WeChat 正常跑
(lldb) detach
(lldb) quit
```

**验证 key 正确**：

```bash
# 把 key 拼起来：
KEY_HEX="aabbcc..."  # 上面读到的 32 字节

# 找一个 .db 文件
DB=$(find ~/Library/Containers/com.tencent.xinWeChat -name "MM.db" | head -1)

# 用 sqlcipher CLI 验证
brew install sqlcipher
sqlcipher "$DB" <<EOF
PRAGMA key = "x'$KEY_HEX'";
.tables
EOF
# 能列出表 → key 正确
# Error: file is not a database → key 错了
```

#### 4.1.4 写成 Python 自动化脚本（2-3 天）

`src/wechat_mac/lldb_extract.py` 用 LLDB Python API 把 4.1.3 的手动流程脚本化。

> ⚠️ **运行方式**：LLDB 的 Python 模块**不是** pip 包（`pip install lldb` 装的是无关项目）。它跟 Xcode 一起发，要么：
> - 进 lldb REPL 跑：`lldb -o "command script import lldb_extract.py" -o "extract_run"`
> - 或外部 python 加 PYTHONPATH：`PYTHONPATH=$(lldb -P) /usr/bin/python3 lldb_extract.py`
> - **不要** 在你的 venv 里 `pip install lldb`

> ⚠️ **launch vs attach 不确定性**（§4.1.0 spike 没解决就要面对）：
> 下面的 sample 用 `target.Launch(...)` 从头启动 WeChat，假设 SQLCipher init 在主进程的某个早期路径。但 WeChat 也可能用 launcher → exec 主进程的方式，那就要 attach 到正在跑的 WeChat。**M1 必须先在 §4.1.3 手动 LLDB 验证**：手动启动 WeChat 看 BP 是否命中、命中时进程名是不是 `WeChat`。如果不是，4.1.4 改成 attach 模式。

```python
# src/wechat_mac/lldb_extract.py（概念示例，真实代码需要异常处理）
import os, time, json, threading
import lldb

OFFSETS = json.load(open(os.path.expanduser("~/.wx-mac/offsets.json")))
DYLIB_SHA = compute_current_dylib_sha()  # 在外面提前算好
cfg = OFFSETS[DYLIB_SHA]                  # KeyError → 提示"未知 dylib，补 offsets.json"

debugger = lldb.SBDebugger.Create()
debugger.SetAsync(True)                   # 异步 + listener，才好做 5min 超时
target = debugger.CreateTarget("/Applications/WeChat.app/Contents/MacOS/WeChat")

# 用 dylib 内偏移下 BP，不是绝对地址（dylib 加载基址会变）
module = target.FindModule(lldb.SBFileSpec("wechat.dylib"))
addr = module.ResolveFileAddress(int(cfg["sqlcipher_init_func_offset"], 16))
bp = target.BreakpointCreateBySBAddress(addr)
bp.SetCondition(f"${cfg['key_length_register']} == 32")

# Launch（如果 spike 表明要 attach 改这里）
launch_info = lldb.SBLaunchInfo([])
err = lldb.SBError()
process = target.Launch(launch_info, err)
if not err.Success():
    raise RuntimeError(f"launch failed: {err.GetCString()}")

# 等 BP 命中：用 SBListener + 超时
listener = debugger.GetListener()
event = lldb.SBEvent()
deadline = time.time() + 300                  # 5 分钟（已登录账号 < 10s 命中；新账号扫码可能更久）
hit = False
while time.time() < deadline:
    if listener.WaitForEvent(2, event):       # 2s 一次
        if process.GetStateFromEvent(event) == lldb.eStateStopped:
            hit = True
            break
if not hit:
    process.Kill()
    raise TimeoutError("BP 5 分钟内未命中。常见原因：用户没扫码 / launch 应改 attach / 偏移过期")

# 读 key
frame = process.GetSelectedThread().GetSelectedFrame()
key_ptr = frame.FindRegister(cfg["key_register"]).GetValueAsUnsigned()
read_err = lldb.SBError()
key_bytes = process.ReadMemory(key_ptr, 32, read_err)
if not read_err.Success():
    raise RuntimeError(f"read key failed: {read_err.GetCString()}")

# 立刻 detach 让 WeChat 自己跑
process.Detach()

# 持久化
keypath = os.path.expanduser("~/.wx-mac/key.hex")
with open(keypath, "w") as f:
    f.write(key_bytes.hex())
os.chmod(keypath, 0o600)
```

**对比原版本错在哪**：原 sample 在同步模式下用 `while GetState() != eStateStopped + sleep(0.5)` polling，但 `LaunchSimple` 在同步模式下返回时进程**已经是 stopped 状态**（at-entry），循环立刻退出而 BP 还没命中；`elapsed` 变量也没定义；用 `LaunchSimple` 也无法解决 5min 超时。修法是异步 + SBListener + 显式 WaitForEvent。

CLI 入口：

```bash
$ python -m wechat_mac init
[init] WeChat 已退出，准备启动并 attach...
[init] LLDB 启动 WeChat ✓
[init] 等待用户扫码登录（最多 5 分钟）...
[init] 断点命中 ✓
[init] 读到 32 字节 key ✓
[init] Detach ✓
[init] Key 已保存到 ~/.wx-mac/key.hex (mode 0600)
[init] WeChat 继续运行，可以 Cmd+Tab 切回去用
```

#### M1 验证标准

- [ ] `python -m wechat_mac init` 一条命令跑通
- [ ] `~/.wx-mac/key.hex` 32 字节，权限 600
- [ ] 用这个 key 能 `sqlcipher` 命令行打开任意一个微信 .db 文件
- [ ] 重启 WeChat 后再跑 `init` 不会因为缓存 key 失败（识别到 WeChat 重启了）
- [ ] WeChat 升级后（dylib SHA 变了），跑 `init` 能给出可读的报错（"未知 dylib，请补 offsets.json"），而不是崩溃

#### 4.1.5 Plan C：M1 完全失败怎么办

如果 §4.1.0 spike + §4.1.2-4.1.4 全部失败（一周后还拿不到 key），不要硬刚——切到 plan C：

1. **跟 [@WechatCliBot](https://t.me/WechatCliBot) 申请 leeguooooo 激活码**（审核 1-24h，免费）
2. 装 leeguooooo 二进制（`vendor/wechat-skill/install.sh` 已 clone，但要在 Mac 上跑）
3. 跑一次 `wechat init`，让它把 key 写到 `~/.wx-rs/key.hex`
4. 你的 wechat_mac 项目从 `~/.wx-rs/key.hex` 读 key，**跳过你自己的 M1**，直接进 M2

**取舍**：
- ✅ 不卡在 M1，能继续学 M2-M6 的工程价值
- ❌ 失去"白嫖完整路线"的纯洁性（key 提取仍依赖 leeguooooo）
- ❌ leeguooooo 激活码 30 天到期要续，依赖外部服务
- ⚠️ 这相当于"路线 B-降级版" —— 不丢人，**烂尾比凑合更糟**

> 心理预算：如果 §4.1.0 spike 失败 + 自逆 7 天没进展，**必须**切 Plan C。不要超过 14 天硬刚 M1。

#### M1 风险与应对

| 风险 | 概率 | 应对 |
|---|---|---|
| 找不到 SQLCipher 入口（dylib 高度混淆） | 中 | §4.1.0 spike 现成方案；都不行走 Plan C |
| LLDB attach 失败（entitlement 没生效 / App Translocation） | 中 | scripts/codesign_wechat.sh 自动重做；`xattr -cr /Applications/WeChat.app` 清 quarantine |
| Tencent 热更换 dylib | 高 | offsets.json 维护新 SHA 映射，是常态运维 |
| 5 分钟内用户没扫码（仅新账号场景；已登录账号 < 10s 命中） | 低 | 超时报错让用户重跑 |
| arm64 寄存器约定记错 | 中 | §4.1.2 警告：寄存器**必须实测**不能照搬表格 |
| BP 命中位置不对（在 sqlite3_key 调用之前 vs 之后） | 中 | 必要时改成调用入口 + 出口都下 BP，比对 |
| launch vs attach 路径错（WeChat 用 launcher 启动主进程） | 中 | §4.1.3 手动验证哪条对；自动化脚本根据验证结果选 |
| 自逆 14 天没进展 | 低 | §4.1.5 Plan C，不丢人，烂尾才丢人 |

---

### M2：SQLCipher 直读（目标 1 周）

**目标**：用 M1 拿到的 key 打开微信本地 DB，实现 `sessions / contacts / history / search` 4 个查询命令。

#### 4.2.1 找到所有 .db 文件（半天）

```bash
# scripts/find_db_paths.py
WECHAT_CONTAINER=~/Library/Containers/com.tencent.xinWeChat
find "$WECHAT_CONTAINER" -name "*.db" 2>/dev/null

# 预期会看到（路径会带 wxid）：
# .../<wxid>/Message/msg_0.db
# .../<wxid>/Message/msg_1.db    # 历史消息分片
# .../<wxid>/Contact/wccontact_new2.db
# .../<wxid>/Session/SessionDB.db
# .../<wxid>/Favorites/favorites.db
# .../<wxid>/MediaMsg/MediaMSG.db
```

> ⚠️ 多账号情况：`<wxid>` 目录会有多个，要从 `~/.wx-mac/config.json` 里指定当前活跃账号，或用最新 mtime 的目录。

#### 4.2.2 摸清 schema（1-2 天）

**这一步最关键，因为微信 DB schema 没有官方文档**。

```python
# scripts/inspect_schema.py
import os
from pysqlcipher3 import dbapi2 as sqlcipher

key_hex = open(os.path.expanduser("~/.wx-mac/key.hex")).read().strip()

# ⚠️ DB 在使用中被 WeChat 用 WAL 模式锁着，shutil.copy 三个文件不是原子，
# 状态可能不一致。用 sqlite3 backup API 安全复制（自带读锁协调）。
def safe_copy_db(src: str, dst: str, key_hex: str) -> None:
    src_conn = sqlcipher.connect(src)
    src_cur = src_conn.cursor()
    # ⚠️ PRAGMA 顺序极其重要：cipher_compatibility 必须在 PRAGMA key 之前。
    #    顺序反了会报 "file is not a database"，新手最常见踩坑。
    src_cur.execute("PRAGMA cipher_compatibility = 4;")  # WeChat 4.x 用 SQLCipher 4
    src_cur.execute(f"PRAGMA key=\"x'{key_hex}'\";")
    # 验证 key 正确
    src_cur.execute("SELECT count(*) FROM sqlite_master;")
    src_cur.fetchone()  # 错 key 会在这里抛 DatabaseError

    # backup 到目标 file（明文）—— 备份后 dst 可以无 key 打开
    # 实际项目应该备份后**再 attach key 写回加密版本**或保持加密
    # 这里 inspect 用途简单起见就用明文
    dst_conn = sqlcipher.connect(dst)
    dst_cur = dst_conn.cursor()
    # 用 sqlite3 backup API（pysqlcipher3 的 backup 方法）
    src_conn.backup(dst_conn)  # 原子，自动协调 WAL
    src_conn.close()
    dst_conn.close()

safe_copy_db(db_path, "/tmp/inspect.db", key_hex)

# 之后用普通 sqlite3 读 /tmp/inspect.db（已是明文）
import sqlite3
conn = sqlite3.connect("/tmp/inspect.db")
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [r[0] for r in cur.fetchall()]
for name in tables:
    print(f"=== {name} ===")
    cur.execute(f"SELECT * FROM \"{name}\" LIMIT 5;")
    print([d[0] for d in cur.description])
    for row in cur.fetchall():
        print(row)
```

> ⚠️ **PRAGMA 顺序坑**：`cipher_compatibility` 必须在 `PRAGMA key` **之前** 设置，否则 SQLCipher 用默认（v4）配置去解密，跟 WeChat 实际加密用的版本不匹配就报 "file is not a database"。如果 WeChat 用的是 v3，把 4 换成 3。这个顺序坑文档原版写反了，是 SQLCipher 新手最常见踩坑。

**已知社区结论**（参考自 PyWxDump、知乎逆向文章；4.x 版本细节自己验证）：

| 表 | 内容 | 关键字段 |
|---|---|---|
| `Chat_<md5(wxid)>` | 单聊消息（每联系人一张表） | `mesLocalID, mesSvrID, CreateTime, Message, Status` |
| `Chat_<md5(group)>@chatroom` | 群消息 | 同上 + `senderId` |
| `WCContact` / `Friend_<id>` | 联系人 | `m_nsUsrName, m_nsRemark, m_nsNickName, m_nsAliasName` |
| `SessionAbstract` | 会话列表 | `m_nsUsrName, m_nMsgLocalID, m_uLastTime, m_uUnReadCount` |
| `ChatRoom` | 群信息 | `m_nsUsrName, m_nsRoomData (proto buf!)` |

> ⚠️ **群成员存在 `m_nsRoomData` 的 protobuf blob 里，不是关系表**。M2 暂时不解 protobuf，群成员功能放 v2。

**导出 schema 文档**到 `lab/wechat-mac/docs/db-schema.md`。

#### 4.2.3 实现查询命令（2-3 天）

`src/wechat_mac/queries.py`：

```python
def list_sessions(limit: int = 20) -> list[dict]:
    """对应 leeguooooo 的 wechat sessions"""
    sql = """
    SELECT m_nsUsrName, m_uLastTime, m_uUnReadCount,
           m_nsLastMsg
    FROM SessionAbstract
    ORDER BY m_uLastTime DESC
    LIMIT ?
    """
    rows = db.query(sql, (limit,))
    return [resolve_display_name(r) for r in rows]

def history(chat_id: str, n: int = 50) -> list[dict]:
    """对应 wechat history"""
    table = f"Chat_{md5(chat_id).hexdigest()}"
    sql = f"SELECT mesLocalID, CreateTime, Message, Status FROM {table} ORDER BY CreateTime DESC LIMIT ?"
    return db.query(sql, (n,))

def search(keyword: str, in_chat: str | None = None) -> list[dict]:
    """对应 wechat search"""
    # 全 DB 跨表搜（性能差但简单）
    ...

def resolve_recipient(hint: str) -> str | None:
    """对应 wechat send 的模糊匹配"""
    # 1. wxid 形态直接返回
    if hint.startswith("wxid_") or hint.endswith("@chatroom") or hint == "filehelper":
        return hint
    # 2. 备注 → 昵称 → 别名 顺序匹配，session-recency 加权
    ...
```

#### 4.2.4 CLI 输出（1 天）

参考 leeguooooo SKILL.md 的「YAML 默认 + `--json` 切换」约定。用 `pyyaml` + `rich`：

```bash
$ python -m wechat_mac sessions --brief -n 5
- name: 文件传输助手
  wxid: filehelper
  unread: 0
  last: 2026-05-06 09:13
- name: 张三
  wxid: wxid_abc123
  unread: 3
  last: 2026-05-06 08:45
```

#### M2 验证标准

- [ ] `python -m wechat_mac sessions -n 10` 返回的会话跟微信里看到的一致
- [ ] `python -m wechat_mac contacts --query 张` 能模糊匹配
- [ ] `python -m wechat_mac history filehelper -n 20` 能拿到最近 20 条
- [ ] `python -m wechat_mac search "会议"` 能跨表搜
- [ ] 所有命令支持 `--json` 切换输出
- [ ] DB 在使用中不会让查询失败（**WAL 复制策略**奏效）

#### M2 风险

| 风险 | 应对 |
|---|---|
| pysqlcipher3 在 macOS arm64 装不上 | 改用 `sqlcipher3-binary` wheel；都不行就 ctypes 调 brew 装的 sqlcipher 库 |
| WeChat 4.x SQLCipher 版本对不上（v3 vs v4） | `PRAGMA cipher_compatibility = 4`；不行试 3 |
| schema 跟社区文档不一样 | 这是大概率事件，**所有字段名以你 inspect 出来的为准** |
| WAL 锁导致复制不完整 | 用 `sqlite3 backup` API 而不是 `cp` |

---

### M3：UI 合成发送（目标 1-2 周）

**目标**：实现 `python -m wechat_mac send "<text>" <recipient>`，能可靠发到指定联系人/群。

> **注意**：M3 强依赖 M2（delivery verify 用了 `query_recent + fromSelf`）。**不要把 M3 当独立里程碑跑**，M2+M3 才是最小可用工具。§7 已纠正。

#### 4.3.0 ⭐ 第 0 步 spike：怎么"通过 wxid 直达聊天窗口"（半天，决定 M3 上限）

**核心问题**：M2 的模糊匹配能从"张三"这个 hint 解析到 wxid `wxid_abc123`，但 §4.3.2 的 AppleScript 实际是 Cmd+F 搜索**显示名**——对多个同名"张三"它跟 wxid 解析出来的根本不是一个人。**这是 M3 隐藏致命点**。

候选解决方案（按优先尝试）：

| 方案 | 验证方法 | 备注 |
|---|---|---|
| URL scheme `weixin://chat?wxid=xxx` | `open "weixin://..."` 看是否打开对应聊天 | 如果 WeChat 4.x 注册了这个 scheme 直接通杀 |
| 走 SessionAbstract 顺序 + 键盘 ↓ | M2 查 wxid 在会话列表里的 index，搜索后键盘下移 N 次 | 脆弱，会话顺序变了就崩 |
| AppleScript 直接操作会话列表（不走搜索） | 看 `tell process "WeChat"` 能否枚举会话项点击 | 取决于 Accessibility tree 是否暴露 |
| **接受现状：只支持 wxid 形态发送，砍掉 fuzzy match** | — | 砍功能保正确，不能模糊"张三"，必须给 `wxid_abc123` |

**spike 输出**（写进 `lab/wechat-mac/docs/send-comparison.md`）：

- ✅ URL scheme 通了 → §4.3.2 改成"先 `open weixin://...`，再键盘输入文字"，fuzzy match 完全可用
- ⚠️ 全失败 → §4.3.4 fuzzy match 砍掉，CLI 接口改成 `wechat send <text> <wxid>` 强制 wxid 形态
- 中间方案：fuzzy match **保留但只在唯一匹配 / 最近活动唯一时**自动发；多匹配直接 ambiguous，不再尝试键盘 ↓ 选择

> ⚠️ **不要跳过这个 spike**。原文档 §4.3.4 假装 fuzzy match 能用，但底层 §4.3.2 是搜索显示名 —— 解析出 wxid 跟搜出来的不是同一个人。轻则发错给同名好友，重则发错给陌生人，**不可接受**。

#### 4.3.1 路线选择（半天）

| 方案 | 优点 | 缺点 | 选用 |
|---|---|---|---|
| AppleScript + System Events | 原生 macOS 自动化，不抢焦点的方式比较多 | WeChat 4.x 对 AS 支持有限 | **优先尝试** |
| pyautogui | huangdijia 已验证，最简 | 抢焦点，UI flash | **fallback** |
| 直接 Hook Qt slot | 零 flash | 3-6 周深 RE | **跳过** |

> ⚠️ **两条路线都要 Accessibility 权限**：System Settings → Privacy & Security → Accessibility → 加 Terminal.app（或 iTerm/你跑脚本的 host）。没勾 silent fail，键盘事件根本不发出去。第一次跑 M3 之前先 `wechat_mac doctor` 检查这个权限，不要等 send 失败才回头排查。

#### 4.3.2 AppleScript 路线（2-3 天）

先研究 WeChat 4.x 暴露了哪些 AppleScript dictionary：

```bash
osascript -e 'tell application "WeChat" to get name of every window'
# 如果能输出窗口名，说明 AS 接口存在

# 看 dictionary
open /Applications/WeChat.app  # 然后 Script Editor → File → Open Dictionary
```

如果 WeChat 没开放 AS dictionary（很可能），退回到 **System Events** 通用 GUI 自动化：

```applescript
tell application "WeChat" to activate
delay 0.3

tell application "System Events"
    tell process "WeChat"
        keystroke "f" using command down       -- Cmd+F 聚焦搜索
        delay 0.2
        keystroke "张三"                         -- 输入联系人
        delay 0.5
        keystroke return                         -- Enter 进入聊天
        delay 0.5
        keystroke "你好"                         -- 输入消息
        keystroke return                         -- 发送
    end tell
end tell
```

封装到 `src/wechat_mac/send_applescript.py`：

```python
def send_text(recipient: str, text: str) -> dict:
    # 用 M2 的 resolve_recipient 把 hint → wxid（确保有结果）
    wxid = resolve_recipient(recipient)
    if wxid is None:
        return {"status": "ambiguous", "candidates": [...]}

    # 通过 AS 发送
    script = AS_TEMPLATE.format(name=display_name_of(wxid), text=text)
    subprocess.run(["osascript", "-e", script], check=True)

    # 验证：M2 查 DB，看新消息是否落库
    time.sleep(1.5)
    new_msgs = query_recent(wxid, since=t0)
    if any(m.text == text and m.from_self for m in new_msgs):
        return {"status": "delivered", ...}
    return {"status": "submitted_unconfirmed", ...}
```

#### 4.3.3 pyautogui fallback（1 天）

如果 AppleScript 路线在某些场景不稳（比如 WeChat 没开窗口、聚焦逻辑有问题），用 pyautogui 兜底。**完全照抄 huangdijia/wechat-skills 的 113 行**，但加一层：

- 在 send 前先 `screenshot` 保存现场，失败时附在错误日志里
- send 后用 M2 查 DB 确认是否真的发出去（**这是 leeguooooo 的"delivery verify"思路**）

#### 4.3.4 模糊匹配 + 歧义处理（1-2 天）

跟 leeguooooo SKILL.md 的语义对齐：

```python
def send_with_resolution(text: str, hint: str, dry_run: bool = False) -> dict:
    if is_wxid_shape(hint):
        return _send(hint, text, dry_run)

    matches = fuzzy_match(hint)  # 备注 / 昵称 / 别名
    if not matches:
        return {"status": "no_match", "hint": hint}

    # session-recency 加权：30 天内有活动的优先
    recent = [m for m in matches if m.last_seen_within(days=30)]
    if len(recent) == 1:
        return _send(recent[0].wxid, text, dry_run)
    if len(matches) == 1:
        return _send(matches[0].wxid, text, dry_run)
    return {
        "status": "ambiguous",
        "hint": hint,
        "candidates": [m.to_dict() for m in matches],
        "note": "multiple matches; pass one of the wxids explicitly"
    }
```

#### M3 验证标准

- [ ] `python -m wechat_mac send "hi" filehelper` 能在自己的"文件传输助手"看到这条消息
- [ ] `python -m wechat_mac send "hi" 张三` 能成功发到张三
- [ ] 多个张三时返回 `status: "ambiguous"` + candidates
- [ ] `--dry-run` 不真发但能跑通解析
- [ ] 发送后 1.5s 内能从 DB 查到 fromSelf 的同文本消息（delivery verify）
- [ ] 失败时返回有用诊断（不是 silent fail）

#### M3 风险

| 风险 | 应对 |
|---|---|
| AppleScript 完全不可用 | 直接走 pyautogui，接受 UI flash |
| 抢焦点期间用户在打字 | README 警告 + send 前提示 |
| Cmd+F 搜索框定位不到正确联系人（多个同名） | 用 wxid 直接找会话快捷键？4.x 应该没有，回退到先搜→键盘 ↑↓ 选择 |
| 发送后 DB 没立刻落库 | 重试 3 次（每次 sleep 500ms） |

---

### M4：收消息流（目标 1 周）

**目标**：实现 `python -m wechat_mac listen`，新消息实时打到 stdout / 调 webhook。

#### 4.4.1 文件 mtime 轮询（2 天）

```python
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class MsgDBHandler(FileSystemEventHandler):
    def __init__(self):
        self.last_seq = self._load_checkpoint()

    def on_modified(self, event):
        if not event.src_path.endswith("msg_0.db"):
            return
        # WAL 复制 + 增量查询
        new_msgs = self._fetch_since(self.last_seq)
        for msg in new_msgs:
            yield_msg(msg)
            self.last_seq = msg.seq
        self._save_checkpoint(self.last_seq)
```

> ⚠️ 微信消息表 schema 一般有 `mesSvrID` (server-side seq) 或 `CreateTime`。**用 seq 而不是时间戳**做 checkpoint，避免时钟跳变 bug。

#### 4.4.2 SSE / stdout / webhook 输出（2 天）

跟 leeguooooo SKILL.md 的 v1.10.28 SSE schema 对齐（最小子集）：

```python
@dataclass
class SSEPayload:
    messageId: str
    chatId: str
    senderId: str
    senderName: str
    chatName: str
    isGroup: bool
    body: str
    fromSelf: bool          # CRITICAL：避免 self-echo loop
    isMentioned: bool       # 群里 @ 我
    timestamp: int
    messageKind: str        # text/image/url/...

# CLI 用法对齐 leeguooooo
python -m wechat_mac listen                       # 全部新消息打 stdout
python -m wechat_mac listen --wxid filehelper     # 只看某 chat
python -m wechat_mac listen --on-message ./reply.sh  # 触发外部脚本
```

#### 4.4.3 daemon 模式（1-2 天）

```python
python -m wechat_mac daemon start    # 起后台
python -m wechat_mac daemon status   # 查
python -m wechat_mac daemon stop     # 停
```

实现可以简单：写个 LaunchAgent plist 到 `~/Library/LaunchAgents/`，用 `launchctl load`。

#### M4 验证标准

- [ ] `listen` 能实时（< 3 秒延迟）打出新消息
- [ ] checkpoint 持久化：listen kill 重启不会重复推送
- [ ] `--wxid` 过滤生效
- [ ] `fromSelf` 字段正确（不会自己回自己）

---

### M5：HTTP + SSE Bridge（目标 1-2 周）

**目标**：起一个 `127.0.0.1:18400` 的 FastAPI 服务，提供 leeguooooo 那 8 个路由的子集。

#### 4.5.1 路由（1 周）

| Method | Path | 实现 |
|---|---|---|
| GET | `/health` | 直接返回 `{"ok": true, "key_loaded": ...}` |
| GET | `/chats` | 调 M2 list_sessions |
| GET | `/chat/:wxid/history` | 调 M2 history |
| GET | `/contacts` | 调 M2 |
| POST | `/send` | 调 M3 send |
| GET | `/messages/stream?since=<epoch>` | 调 M4 listen 包成 SSE。⚠️ `since` **必填**——缺失返回 400，不要默认 0（leeguooooo SKILL.md 反复警告：默认 0 = 回放全部本地历史，几秒爆 1MB+）。如果想"only live"明确传 `since=$(date +%s)` |
| GET | `/resolve` | 调 M2 resolve_recipient |
| POST | `/typing` | typing indicator（v2，先返回 501 not implemented；保留路由对齐 leeguooooo 8 路由） |

#### 4.5.2 鉴权（半天）

环境变量 `WECHAT_BRIDGE_BEARER=<secret>`，非 `/health` 路由检查 `Authorization: Bearer <secret>`。

#### 4.5.3 schema 文档（2 天）

JSON Schema 文件 `src/wechat_mac/schemas/sse-v1.json`，CI 跑 contract test 防漂移（参考 leeguooooo 的 sse-payload-v1.10.28）。

#### 4.5.4 ⭐ 探索：对齐 Hermes adapter schema（决定要不要做的关键决策点）

**背景**：M5 跑通后会面临一个分叉——

```
分叉 A（自路）：自己写 SKILL.md 给 Claude Code 用 → 进 M6
分叉 B（借力）：对齐 Hermes 的 bridge 协议 → 把本机微信挂进 hermes-agent 当一个 platform
              → 自动复用 Hermes 已有的 LLM 路由 / 工具系统 / cron / 通知
              → 省掉自写 SKILL.md
```

**线索**：`vendor/wechat-skill/SKILL.md` 第 102 行提到：

> `wechat-bridge` ... 可加 `--shape hermes` 跟 Hermes WhatsApp-bridge 同 shape 零适配

**待确认**：
- `hermes-agent` 这个仓库里 `gateway/platforms/whatsapp.py` 是**内置 Baileys** Node.js 子进程，不是 HTTP 外部 bridge
- 所以 leeguooooo 说的 "Hermes WhatsApp-bridge" 应该是**另一个独立项目**（不在 hermes-agent 仓库里），具体 schema 要 M5 时实查
- 候选搜索方向：GitHub `hermes whatsapp bridge`、leeguooooo 的 release notes、hermes-agent 的 `platforms/webhook.py` 看通用 bridge 协议

**M5 末尾要做的决策**：

1. 实地读 `vendor/hermes-agent/gateway/platforms/whatsapp.py` 和 `webhook.py`
2. 搜出真正的 "Hermes WhatsApp-bridge" 项目（如果存在）
3. 评估对齐成本：< 1 周 → 走分叉 B；≥ 1 周 → 走分叉 A
4. 不论哪条，自定义 schema 永远是 fallback，不要因为对齐 Hermes 而把 schema 锁死

#### M5 验证标准

- [ ] `curl localhost:18400/health` 返回 200
- [ ] `curl -X POST .../send -d '{"wxid":"filehelper","text":"hi"}'` 成功
- [ ] `curl -N .../messages/stream?since=$(date +%s)` 能拿到 SSE 流
- [ ] 设了 BEARER 后未带 token 返回 401

---

### M6：SKILL.md + Claude Code 接入（目标 3 天）

> ⚠️ **可能跳过**：如果 M5 §4.5.4 的探索决定走分叉 B（对齐 Hermes bridge schema），M6 直接变成"挂进 hermes-agent → 跑通端到端"，这一节就不用了。下面默认走分叉 A（自写 SKILL.md）。

#### 4.6.1 写 SKILL.md（2 天）

照搬 leeguooooo SKILL.md 的结构，但删掉「不做的功能」（Wechaty / orchestrate / tunnel / image）。重点保留：

- Fast path 解析规则（wxid shape → 直发；模糊匹配 → recency 加权）
- 歧义返回 schema + agent 处理示意
- 安全规则（DO NOT 列表：guess wxid / scan 文件系统 / 调 contacts 再调 send）
- SSE consumer checklist（fromSelf 过滤 / isGroup+isMentioned）
- 首次使用流程（init → codesign → permission）

#### 4.6.2 Claude Code 接入（半天）

写 `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`，让用户能 `npx skills add ai-lab/wechat-mac` 装上。

#### 4.6.3 端到端测试（半天）

跟 Claude Code 真实跑一组场景：

```
> 查最近 5 个会话
> 给最近联系最多的那个人发"早上好"
> 监听有人 @ 我
```

---

## 5. 风险登记册（Top-Down）

| ID | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | M1 找不到 SQLCipher key 写入点 | 中 | **致命**，整个项目挂 | 用 PyWxDump-macOS 等已有项目验证一遍；找不到先用现有工具凑合 |
| R2 | macOS 升级把 entitlement 玩法堵死 | 低 | 高 | 这是 Apple 长期路线，但 `get-task-allow` 已经存在多年，不会突变 |
| R3 | WeChat 自动更新覆盖 codesign | 高 | 中 | scripts/codesign_wechat.sh 自动重做；提示用户关 WeChat 自动更新 |
| R4 | Tencent 热更换 dylib，offset 漂移 | 高 | 中 | offsets.json 维护映射；leeguooooo 的解法是服务端 push，个人项目接受手动维护 |
| R5 | M2 schema 跟社区文档对不上 | 高 | 低 | 一切以 inspect_schema.py 实测为准 |
| R6 | M3 AppleScript 路线完全跑不通 | 中 | 中 | pyautogui fallback 兜底（等于 huangdijia 那套） |
| R7 | M4 watchdog 在 macOS 高负载下漏 mtime 事件 | 低 | 中 | 加一个 1s 兜底定时器 |
| R8 | 整个项目违反微信 ToS 被封号 | 低 | **致命** | 只用自己的小号；不做群发；不做营销；遵守 leeguooooo DISCLAIMER 同款约束 |
| R9 | 业余时间不够，烂尾 | 中 | 中 | M1+M2+M3 跑通已经是有用的工具；M4-M6 都是锦上添花 |
| R10 | 中途被 hermes-agent iLink 看似"更简单"诱惑切换路线 | 中 | 高 | iLink 是**独立 bot 身份**，做不了"用我的账号给张三发"。每次想切之前重读 §1.4 三路线对比表 |
| R11 | M5 对齐 Hermes schema 走偏（找的不是真的 WhatsApp-bridge 协议） | 中 | 低 | 设硬约束：对齐成本 ≥ 1 周就放弃，回退分叉 A 自写 schema |

---

## 6. 不做的事（明确划线）

避免范围蔓延，**以下功能在 v1 不做**：

- ❌ Qt slot signal 注入（→ 接受 UI flash）
- ❌ 图片/文件/语音/视频发送（v2）
- ❌ 图片堆扫描 + CDN 回放（v2）
- ❌ 朋友圈、收藏、转账、红包（v2）
- ❌ 收消息的 < 1s 实时性（接受 1-3s 轮询延迟）
- ❌ 群成员列表（要解 protobuf，v2）
- ❌ Wechaty puppet-service gRPC 协议（v2）
- ❌ 远程驱动 / orchestrate / Cloudflare tunnel（个人用不需要）
- ❌ 服务端 profile API 推送 offsets（个人用，手动维护）
- ❌ 激活码鉴权（个人用，纯本地）
- ❌ Windows / Linux / Intel Mac 兼容
- ❌ macOS < 14 兼容
- ❌ **不走 iLink Bot API 路线**（hermes-agent `platforms/weixin.py` 走的就是这个）—— 它是独立 bot 身份（`xxx@im.bot`），跟"控制我自己的微信号"是完全不同的需求。详见 §1.4。如果未来想做"对外的微信 AI 助手 bot"，**直接用 hermes-agent**，别用路线 B 凑合

---

## 7. 阶段性目标（哪一步停下来都有用）

```
M1 跑通       → 有了 SQLCipher key（自逆 or §4.1.5 Plan C）
M1+M2 跑通    → 已经能拿到所有聊天数据，可以做导出/分析/备份工具（独立可用！）
M1+M2+M3 跑通 → 一个能用的 CLI WeChat 发送+查询工具
                ⚠️ M3 强依赖 M2（delivery verify 用 M2 的查询），不能跳过 M2
M1-M4 跑通    → 一个能监听 + 自动回复的 bot 框架
M1-M5 跑通    → 能给任意 HTTP 客户端用的本地 API
M1-M6 跑通    → AI agent 友好，对齐 leeguooooo 完整功能（除了被砍掉的）
```

依赖图（实线 = 强依赖）：

```
        ┌──────────┐
        │  M1 key  │
        └────┬─────┘
             ↓
        ┌──────────┐         ┌──────────┐
        │ M2 DB 读 │ ←────── │ M3 发送  │
        └────┬─────┘         └────┬─────┘
             ↓                    ↓
        ┌──────────┐              │
        │ M4 监听  │              │
        └────┬─────┘              │
             ↓                    ↓
            ┌─────────────────────┐
            │  M5 HTTP+SSE Bridge │
            └──────────┬──────────┘
                       ↓
                ┌─────────────┐
                │ M6 SKILL.md │
                └─────────────┘
```

每个 M 跑完都打 git tag。**M2 是关键节点**——M2 没跑通其他全垮，M2 跑通光凭它就有产出（聊天数据导出/分析/备份）。

---

## 8. 进度跟踪机制

**强烈建议**：进入 M1 时启用 `planning-with-files-zh` skill，在 `lab/wechat-mac/` 下创建 `task_plan.md` / `progress.md` / `findings.md` 三件套。

- `task_plan.md` — 当前在 M 几、当前任务、下一个任务
- `progress.md` — 按日期记录每天改了什么
- `findings.md` — 记录踩的坑、reverse engineering 发现（这个项目最值钱的资产）

`findings.md` 在这个项目里特别重要：你逆出来的 SQLCipher 函数偏移、DB schema、AppleScript 行为差异，都是**未来会忘掉的**，一定要写下来。

---

## 9. 参考资料

### leeguooooo 文档（已 clone 到 vendor/）
- `vendor/wechat-skill/SKILL.md` — 全功能规范，逐章对照
- `vendor/wechat-skill/docs/why-init.md` — Key 提取设计思路
- `vendor/wechat-skill/docs/v1.12-orchestrate-protocol.md` — 远程协议（不做但值得读）

### 工具与文档
- [LLDB Python API 官方](https://lldb.llvm.org/python_api.html)
- [SQLCipher Cipher Compatibility](https://www.zetetic.net/sqlcipher/sqlcipher-api/) — `cipher_compatibility` 各版本差异
- [pysqlcipher3 文档](https://github.com/rigglemania/pysqlcipher3)
- [Apple Codesigning Entitlements 官方](https://developer.apple.com/documentation/bundleresources/entitlements)
- [PyWxDump](https://github.com/xaoyaoo/PyWxDump) — Windows 主导但有 macOS 实验分支可参考
- [WeChat-Mac 各路逆向博客](https://www.google.com/search?q=wechat+mac+sqlcipher+key+lldb) — 中英文都搜

### 类似项目对比
- `vendor/wechat-skills/`（huangdijia） — 113 行 pyautogui，**M3 直接抄** + 加 DB verify
- WeChatTweak-macOS（GitHub 搜） — 老项目，dylib 注入路线，看作 M2 schema 参考
- Hermes WhatsApp Bridge — leeguooooo `--shape hermes` 的对齐目标，M5 schema 参考（**不在 hermes-agent 仓库里，是独立项目，M5 时实查**）

### Hermes Agent（关联但不替代）
- `vendor/hermes-agent/website/docs/user-guide/messaging/weixin.md` — 官方 iLink Bot API 接入文档（**不是路线 B 的目标，但解释了"通过腾讯官方途径接微信"的能力边界**）
- `vendor/hermes-agent/gateway/platforms/weixin.py` — iLink HTTP 长轮询 + AES-128-ECB CDN 实现，~1500 行 Python
- `vendor/hermes-agent/gateway/platforms/whatsapp.py` — Baileys 内置 bridge，**不是 leeguooooo 对齐的那个**
- `vendor/hermes-agent/gateway/platforms/webhook.py` — 通用 webhook adapter，M5 探索分叉 B 时先读这个

---

## 10. 开始第一步

Mac 到位后，执行：

```bash
# 在 Mac 上 clone 仓库
git clone <ai-lab repo url>
cd ai-lab

# 进入 lab/wechat-mac/（先建空骨架）
mkdir -p lab/wechat-mac/{src/wechat_mac,scripts,tests,docs}
cd lab/wechat-mac

# pnpm workspace 不会动 lab/wechat-mac（Python 项目），但仍按 ai-lab 的 lab/ 规则：
#   - private（无 package.json 也行，没有不会被 npm 收录）

# 初始化 Python venv
python3 -m venv .venv
source .venv/bin/activate
# ⚠️ 不要 pip install lldb —— pip 上的 lldb 包跟 Xcode LLDB Python API 完全无关
#    LLDB 的 Python 模块跟 Xcode 一起发，要么进 lldb REPL 跑你的脚本，
#    要么外部 Python 加 PYTHONPATH=$(lldb -P) 调用（详见 §4.1.4 警告）
pip install pysqlcipher3 pyautogui pyyaml typer rich watchdog fastapi uvicorn sse-starlette pyperclip

# 跑 M1 的 §0.5 前置条件检查 → §4.1.0 spike → §4.1.1 环境准备
# 然后开始 §4.1.2 摸清布局（如果 spike 失败要自逆）
```

用 planning-with-files-zh skill 启动跟踪：

```
> /planning-with-files-zh 开始 M1：SQLCipher key 提取
```

---

## 附录 A：M1 关键命令速查表

```bash
# 一次性环境
sudo DevToolsSecurity -enable
xcode-select --install

# WeChat codesign（每次 WeChat 升级后重做）
sudo codesign --force --sign - --entitlements wechat-debug.plist \
  /Applications/WeChat.app/Contents/MacOS/WeChat

# WeChat 状态
defaults read /Applications/WeChat.app/Contents/Info CFBundleVersion
shasum -a 256 /Applications/WeChat.app/Contents/MacOS/wechat.dylib

# LLDB 断点 + 抓 key
lldb /Applications/WeChat.app/Contents/MacOS/WeChat
> breakpoint set --address 0x... 
> breakpoint modify --condition '$w3 == 32' 1
> continue
# 命中后:
> memory read --size 1 --format x --count 32 $x2
> detach

# 验证 key 正确
sqlcipher /path/to/MM.db
> PRAGMA key = "x'<32 字节十六进制>'";
> .tables
```

---

## 附录 B：DB 文件初步指南

```
~/Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/2.0b4.0.9/
└── <wxid_md5>/                       # 你的 wxid 的 MD5
    ├── Message/
    │   ├── msg_0.db                  # 最新消息
    │   ├── msg_1.db                  # 历史分片
    │   └── ...
    ├── Contact/
    │   └── wccontact_new2.db         # 联系人
    ├── Session/
    │   └── SessionDB.db              # 会话列表
    ├── Favorites/
    │   └── favorites.db              # 收藏
    ├── MediaMsg/
    │   └── MediaMSG.db               # 媒体消息元数据
    └── Group/
        └── GroupContact.db           # 群信息
```

> ⚠️ 路径在 4.x 不同小版本可能有变化，**以 `find ~/Library/Containers/com.tencent.xinWeChat -name "*.db"` 实测为准**。

---

## 附录 C：DOs 与 DON'Ts

**DO**：
- 每个 M 完成都 git tag
- `findings.md` 记录所有 RE 发现，越详细越好
- 用自己的小号验证，不要在主号上跑没测过的代码
- 保留 huangdijia 实现作为 M3 的兜底参考

**DON'T**：
- 不要群发（违反微信 ToS，封号）
- 不要把 `~/.wx-mac/key.hex` 提交到 git
- 不要在 `wechat init` 跑的同时操作 WeChat（断点会乱）
- 不要跳过 M2 直接做 M3（没有 delivery verify 的 send 是不可靠的）
- 不要在第一次 codesign 完之前重启 Mac（可能触发 Gatekeeper 重新校验）
