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

> **Gotcha(目录 diff 捕获 sessionRef 会串会话)**:reasonix 靠"运行前后目录差集"定位新会话文件,`--metrics`/stdout **都不带 session id**,无法权威归属。两个相同 cwd 的实例并发时,差集会混入他进程新建的 jsonl,被当可信 ref 返回 → 下轮 `--resume` 续到别人线程。
>
> **规则**:目录 diff 捕获**只有恰好新增 1 个文件才算唯一归属**,返回该绝对路径;新增 0 个或 ≥2 个都无法唯一归属 → 降级为不可信哨兵(如 reasonix 的 `@last`),让上层走全量新会话并告警,**绝不 `.sort(mtime)[0]` 猜最新**。残留限制:"只新增 1 个但其实是他进程建的"需 CLI 暴露 session id 才能根治,在代码注释标注。锚点 `adapters/reasonix.ts` `captureSessionRef`。

## 契约 4:只读代码访问(自读)与 token 口径

让参与者在代码仓库 cwd 下**只读**检索时,各家开关不同:

| CLI | 只读模式 | 备注 |
|---|---|---|
| codex | `-s read-only`(resume 用 `-c sandbox_mode="read-only"`) | 默认即只读,cwd 指向仓库即可 |
| claude | 从"禁工具"(`--tools ""`)切到 `--permission-mode plan --allowedTools Read Grep Glob` | ✅ 已真机核准(2.1.220,2026-07-30:能读文件、`permission_denials` 空、无写入);`roundtable doctor --readonly` 可复验防 flag 漂移;锚点见 `adapters/claude.ts` |
| opencode / reasonix | 自带文件工具,cwd 生效即可读 | 默认是否可写未加固,议题只读场景下暂不深挖 |

**reasonix cwd 副作用**:会话目录按 cwd 键控(`%APPDATA%/reasonix/projects/<cwd 转写>/`)。cwd 从话题目录改成代码仓库后,同一仓库下多话题的会话会落同一 projects 目录;因文件按时间戳命名、resume 用绝对路径,**不冲突**——冒烟核对一次即可。

**token 口径**:各家 usage 的"input"含义不一致——Anthropic 三桶(`input_tokens` / `cache_creation` / `cache_read`)**不相交**;codex/opencode 的主 input 数是**含缓存的总量**,`cached_input_tokens` / `cache.read` 是其子集。统一成 `{ input=全额计费新鲜量, cached=缓存读, output }` 时,codex/opencode 要**减去** cached 避免重复计数(这是原实现的隐藏 bug)。

## 契约 5:统一子进程 helper + 终止必整树 kill

spawn / stdin / 超时杀进程 / stderr 采集 / 退出码→结构化错误 / `windowsHide` 收敛到一个 helper(见 `lab/agent-roundtable/src/adapters/exec.ts`),各 adapter 只负责组装参数与解析输出。

> **Gotcha(`child.kill()` 杀不掉进程树)**:provider CLI 常再拉起 detached 子进程(codegraph / node 子任务)。`child.kill()` 只对直接子进程发信号,Windows 下 detached 孙进程会存活、继续耗 token 或写仓库;`stdout 'error'` 等失败路径若只 `reject` 不杀进程,更是直接漏掉整棵树。
>
> **规则**:任何终止路径都要**整树 kill 后再 settle**:
> - 用 `tree-kill`(Windows `taskkill /T /F`、POSIX 进程树遍历,按 ppid 递归,不需 `detached`/进程组)封装 `killTree(pid)`。
> - **timeout** 路径:`killTree(child.pid)`,整树退出触发 `close` 后再 `reject`(不要只 `child.kill()`)。
> - **流 error / 启动失败**(`stdout.on('error')` 等)路径:先 `killTree` 再 `reject`,不能只 `reject` 把孙进程留下。
> - 用一个 `settled` 单次闸门收敛 timeout / close / fail 三路径,防双 settle;kill 失败也要保证最终 reject 不永挂。
> - 验证:假 provider fork 一个写心跳的 detached 孙进程,超时后断言心跳停止(锚点 `test/exec-treekill.test.ts`)。

---

**Core Principle**: 外部 CLI 的行为以本机实测为准,不以文档/记忆为准——旗标、字段名、安装来源都可能与预期不符。
