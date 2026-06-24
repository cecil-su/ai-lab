# 复刻 wechat-use(macOS 微信本地 API)— 设计 + 分阶段计划

> 立项:2026-06-24 · 状态:Mac 无关部分已做完(Phase 0 全 + Phase 1 读层/解码/导出 + Phase 2 骨架 + 22 单测全绿)。剩 Mac 上活:核 schema、取 key、send。
> 单一来源。会话续接读本文件(根目录 task_plan.md/progress.md/findings.md 当前属于 novel-explore 项目,与本项目无关)。

## 目标

完整复刻 leeguooooo/wechat-use 的能力(macOS 微信 → 本地 API:收集 + 分析 + 发消息),
**自建、不依赖其激活码与服务端 profile API**,offset 表自己维护。分阶段交付,每阶段独立可用。

起点需求:在 macOS 上用 AI **收集 + 分析微信群消息**(只读已能满足),但目标是完整能力。

## 已锁定决策(2026-06-24)

| 决策 | 选择 | 理由 |
|---|---|---|
| 技术栈 | **Python 优先** | lldb 有一等 Python 绑定(取 key/calibrate 迭代最快);sqlcipher/AX(pyobjc)现成。最快做出可用 v1,后期把热点(daemon)移 Rust。代价:分发不如单二进制干净。 |
| 第一阶段范围 | **核心闭环 Phase 0-4** | 先做 取 key + 读 + 实时 + 发;Phase 5(媒体/语音/朋友圈)、6(bridge/wechaty/远程/多账号)延后。 |
| 代码位置 | `lab/wechat-use/`(private) | 实验期低仪式;成熟后毕业到 `tools/`。 |

## 上游性质(重要)

`wechat-use` = `wechat-skill` 改名后继版,**同作者、闭源**:引擎是 Releases 预编译二进制 +
服务端推 offset,激活码 `wechatuse_xxxxxx` 在 `wechatd` 里 gate send/query。
→ **仓库里没有源码可抄**,本仓只能拿到"机制是什么"。自建不碰它的二进制,激活码对自实现无意义。
上游仅供机制参考:`vendor/wechat-use/`、`vendor/wechat-skill/`(后者 SKILL.md 的 Mechanism 段最有料)。

## 硬约束

- **必须在目标 Mac 上开发**(Apple Silicon + 特定 WeChat build)。本仓在 Windows,代码/文档放这,build/test 全在 Mac。
- **取 key 鸡生蛋**:Phase 1 测解密需先有 key(Phase 2)。破法:先**手动 lldb 抓一次 key**当开发数据,把读层建好,再回头自动化。
- **解耦原则**:"取 key/offset(随 build 漂)"与"解密查询+分析(稳定)"彻底分开。WeChat 升级只改 offset 查表那一小块。

---

## 机制蓝图(复刻依据,从上游文档扒)

**适用**:macOS Apple Silicon,WeChat 4.0.x / 4.1.x。offset 需自己逆向(上游靠服务端推)。

### 取 key(Phase 2,易碎)
- WeChat 本地数据 = SQLCipher 加密 SQLite。32 字节 raw key **只在登录瞬间写进内存**。
- 流程:`sudo DevToolsSecurity -enable`(开本地调试,系统级一次性)→ 对**主可执行文件**
  ad-hoc 重签 + `get-task-allow` entitlement(只动 `WeChat.app/Contents/MacOS/WeChat`,不动运行时组件/登录态/数据)
  → **LLDB 在已知写入 offset 下断点**,登录瞬间从寄存器读 key。
- **4.1.9+ 改为内存扫描**(非断点)。
- offset 随每个 build 漂 → 自建需"按 dylib SHA-256 指纹查表",升级只改这张表;`init --calibrate` 在新指纹上自动重定位。
- WeChat 自动更新会覆盖重签,下次 init 自动再修。

### 解密读库(Phase 1,稳定·跨版本通用)
SQLCipher PRAGMA(公开稳定):
```
PRAGMA cipher_compatibility = 4;
PRAGMA kdf_iter = 256000;
PRAGMA cipher_page_size = 4096;
PRAGMA cipher_hmac_algorithm = HMAC_SHA512;
PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512;
```
- 消息表 `Msg_<md5(chat_wxid)>`;群消息 `content` 字段 **zstd 压缩**,正文前有 `<sender_wxid>:\n` 前缀要剥。
- DB 路径 `~/Library/Containers/com.tencent.xinWeChat/...`(子路径待 Mac 上确认)。
- daemon 缓存 SQLCipher 连接(摊薄 PBKDF2)→ 查询 400-500ms 降到 <30ms。

### 实时 listen(Phase 3)
- **watch `message_*.db-wal` 的 mtime** → 查比上次 `create_time` 新的 `Msg_*` 行 → zstd 解压 + 剥群前缀 → 推订阅者。纯本地零网络。

### 发消息 send(Phase 4,第二块逆向)
- AX 设 `AXHidden=True`(静默隐藏)+ setValue 进 `chat_input_field`
- LLDB `WriteMemory` 覆写 `InputView+0x2B8` 塞目标 wxid 的 SSO `std::string`
- LLDB `expression` cold-call `mmui::InputView::Send(0)`(按 RVA)
- **warmup 坑**:WeChat 重启后首次 send 必失败,需用户在客户端手动发一条让 Qt slot_send 信号链 wire 起来(约 5s),之后保持到下次重启。Qt 事件循环固有,自动化替代不了。

### 关键认知
WeChat 4.x Mac 是 **Qt 应用**,AX 无障碍树通常很弱 → "AX 读消息"路线(免逆向)大概率拿不全,
得退到截图+VLM(慢)。完整数据仍走 DB 解密路线。砍掉激活码/profile API/服务端(上游分发生意,本机用不到)。

---

## 分阶段路线图

| Phase | 目标 | 验证 | 状态 |
|---|---|---|---|
| **0 地基** | Python 骨架 + `doctor`:检测版本/build、`.app` 签名状态、DevToolsSecurity、辅助功能、DB 路径 | `doctor` 跑通,正确报环境 | ✅ `lab/wechat-use/`(doctor/dbs/key,Windows 上已跑通) |
| **1 只读查询层** ⭐ | 给定 key,SQLCipher 开库:sessions/contacts/history/search(FTS)/members/stats/export;zstd 解压 + 群前缀剥离 | 对真实解密 DB,`history "群"` 与 UI 一致;`export --json` 干净 | ◐ 骨架建好(tables/schema/query/history),⚠️ 表名/字段假设待 Mac 核 |
| **2 取 key** 🔴 | `init`:DevToolsSecurity → 重签+get-task-allow → LLDB 断点抓 key(4.1.9+ 内存扫描)→ 缓存 `~/.wx-rs/`;带 calibrate | `init` 后 Phase 1 端到端跑通,不手喂 key | ⬜ |
| **3 实时 listen+daemon** | 常驻 daemon(连接池+unix socket);watch `*.db-wal` 出新行;`listen --wxid/--on-message/--format json` | 手机发群消息,<500ms 打印 | ⬜ |
| **4 发消息 send** | AX + LLDB WriteMemory + cold-call Send;warmup 处理;@ 红点 | `send "hi" filehelper` 后台零闪屏送达;群 @ 出红点 | ⬜ |
| 5 媒体增强(延后) | image(heap+CDN+AES)、语音转写(whisper.cpp)、favorites、朋友圈只读、撤回归档 | 逐项对照 | ⏸ |
| 6 集成 surface(延后) | HTTP bridge(REST+SSE)、wechaty gRPC gateway、远程 orchestrate/tunnel、多账号 `--bundle-id`、Claude Code SKILL.md | curl /send、wechaty echo bot | ⏸ |

**排序逻辑**:价值/风险错开——Phase 1(稳、立刻能接 AI 分析)先于 Phase 2(危、隔离);任一 Phase 完成都已是可用工具。

## 进度:Mac 无关部分已做完(2026-06-24)

`lab/wechat-use/`(Python,Windows 上已跑通 + 22 单测全绿):
- `doctor` / `dbs` / `key`(Phase 0)、`tables` / `schema` / `query`(schema 无关,需 sqlcipher+key)。
- `messages.decode_content`:zstd + 群 `<sender>:\n` 前缀 + hex(BLOB 经 `.mode json` 的兜底)+ 边界,全测过。
- `export`:markdown / json,schema 容错(字段名未知也不丢数据)。
- `keyextract.py`:Phase 2 诚实骨架(`fingerprint()` 算 dylib SHA-256 → `OFFSETS` 查表;lldb 驱动 TODO)。

## 剩下的活(只能在 Mac 上)

1. **核 schema**:`dbs` 找库 → `tables`/`schema` 摸清真实表/列 → 回填 `messages.py`(表名 md5 编码、`content`/`create_time` 列名)、`paths.py`(库路径 glob)。content 若是 BLOB 改用 `SELECT hex(content)` 喂 `decode_content(.., is_hex=True)`。
2. **取 key(Phase 2)**:DevToolsSecurity + 重签 → lldb 断点/内存扫描抓 key,逆出 offset 填进 `OFFSETS`,实现 `keyextract.extract_key()`。
3. **Phase 3/4**:listen+daemon、send(AX+lldb cold-call)。

## 风险(诚实)

- 个人自用、人类频率、给自己/熟人/filehelper 发 → 跟正常用微信一个风险等级。
- WeChat **大版本**升级后等自己适配再用;别做加好友/群发(高风险触发风控);重签 `WeChat.app` 改了官方签名,风险自担。
- 这是逆向自己机器上自己的数据,属正当个人自动化;但封号可能非零,先拿小号/filehelper 验链路。
