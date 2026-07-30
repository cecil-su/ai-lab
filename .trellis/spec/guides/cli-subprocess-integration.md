# CLI 子进程集成指南(Windows / AI 终端)

> **Purpose**: 在本仓库把外部 AI CLI(claude/codex/opencode/reasonix 等)作为子进程驱动时,避开已被实测验证过的坑。来源:`lab/agent-roundtable` 步骤 4/9 实测(2026-07-30)。

---

## 何时读本指南

- [ ] 你要 spawn 一个外部 CLI 并解析它的输出
- [ ] 涉及跨调用的会话续接(resume / session id)
- [ ] prompt 含中文或长文本
- [ ] 目标 CLI 在本机可能有多个安装来源(scoop / npm / fnm)

---

## 契约 1:PATH 上可能有同名多装,先解析真实入口

**坑**:`reasonix` 本机同时存在 scoop 的 `reasonix.exe`(旧版 1.17.21)和 npm 全局的 `reasonix.ps1`(正确的 1.8.0-rc.1)。`execFile("reasonix")` 会命中错误的 `.exe`。

**规则**:集成前先确认真实入口,不要假设 PATH 首个命中就对。

```powershell
pwsh -NoProfile -Command "(Get-Command <cli>).Source"   # 得到真实解析路径
```

- 解析到 `.ps1`(npm shim)时,**直接 spawn 其内部实际命令**(如 `<basedir>\node.exe <basedir>\node_modules\<pkg>\bin\<cli>.js`),而不是经 `pwsh` 转发——这样超时能杀准真实进程,而非 pwsh 壳。
- 解析结果缓存;解析到非预期来源时抛结构化错误,不静默降级。

## 契约 2:prompt 一律走 stdin,不进命令行参数

**坑**:中文长文本进命令行参数会遇到 Windows 引号转义;经 `pwsh -Command` 管道传 stdin 时,GBK 控制台的 InputEncoding 会打碎 UTF-8。

**规则**:prompt 用 stdin 传(`child.stdin.write(prompt, "utf8")`),CLI 用 `-`(codex)或原生 stdin(claude/reasonix)接收;绕开 pwsh 管道,直接 spawn 目标二进制。`child.stdin.on("error", () => {})` 吞掉子进程早退的 EPIPE。

## 契约 3:会话续接靠捕获 sessionRef,每家形态不同

各家"新会话→拿引用→续接"的引用形态实测各异,不要照搬:

| CLI | sessionRef 来源 | 续接 |
|---|---|---|
| claude | JSON 结果的 `session_id`(UUID) | `--resume <id>` |
| codex | `thread.started` 事件的 `thread_id`(UUIDv7);resume **不认 `-s`**,改 `-c sandbox_mode="read-only"` | `exec resume <id>` |
| opencode | 事件顶层 `sessionID`(`ses_...`) | `-s <id>` |
| reasonix | 无 id:运行前后 diff 会话目录取新增 jsonl **绝对路径**;续接追加写同一文件 | `--resume <path>`;兜底 `-c` |

**规则**:每家的旗标/字段集中在各自 adapter 文件顶部常量 + 注释,版本漂移只改一处。集成新 CLI 时先跑一次"两问验证记忆续接"的 smoke(问 A → 用返回引用问"你上一条说了什么"),确认引用真的能续上,再接入主流程。

## 契约 4:统一子进程 helper

spawn / stdin / 超时杀进程 / stderr 采集 / 退出码→结构化错误 / `windowsHide` 收敛到一个 helper(见 `lab/agent-roundtable/src/adapters/exec.ts`),各 adapter 只负责组装参数与解析输出。

---

**Core Principle**: 外部 CLI 的行为以本机实测为准,不以文档/记忆为准——旗标、字段名、安装来源都可能与预期不符。
