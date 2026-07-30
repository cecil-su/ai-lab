# roundtable CLI — 技术设计

## 1. 总体架构

```
lab/agent-roundtable/
├── package.json            # private: true, bin: roundtable
├── tsconfig.json           # extends 仓库 tsconfig.base.json(迁出时改为独立配置)
├── src/
│   ├── cli.ts              # 命令入口与路由(new/list/continue/attach/stop/doctor/show)
│   ├── store/              # 话题目录、transcript、inbox 的读写(唯一磁盘层)
│   │   ├── topic.ts        # topic.json 读写与状态机
│   │   ├── transcript.ts   # JSONL 追加/读取/seq 分配/tail 订阅(fs.watch + 轮询兜底)
│   │   └── inbox.ts        # human 插话收件箱(attach 写,runner 消费)
│   ├── adapters/           # provider 适配器(每家一个薄封装)
│   │   ├── types.ts        # ProviderAdapter 接口
│   │   ├── claude.ts / codex.ts / opencode.ts / reasonix.ts
│   │   └── mock.ts         # 确定性 mock,供测试与演示
│   ├── engine/
│   │   ├── runner.ts       # 前台回合循环、暂停/恢复、SIGINT 处理、锁文件
│   │   ├── modes/roundtable.ts  # round-robin 模式
│   │   ├── modes/debate.ts      # 对抗辩论 + 裁决轮
│   │   ├── prompt.ts       # 发言 prompt 组装(charter+立场摘要+上一轮全文+发言协议)
│   │   └── charter.ts      # charter 生成与模板
│   ├── perspectives.ts     # 内置视角模板(6 个)
│   └── tui/                # Ink attach 视图
│       ├── App.tsx         # 布局:滚动历史 / 状态栏 / 输入框
│       └── useTranscript.ts# transcript+inbox 合并订阅
└── topics/                 # 默认话题数据根(可用 ROUNDTABLE_HOME 覆盖)
    └── <topic-slug>/
        ├── topic.json
        ├── charter.md
        ├── transcript.jsonl
        ├── inbox.jsonl
        ├── runner.lock
        └── summary.md      # 结束时生成
```

进程模型(决策 D1):runner 前台进程是唯一的"讨论驱动者";attach 是纯观察+插话进程,可多开。两者只通过话题目录下的文件通信——这条边界就是 v2 runner 后台化的切面。

## 2. 数据契约

### topic.json

```jsonc
{
  "version": 1,
  "id": "2026-07-29-cache-strategy",       // slug,目录名一致
  "title": "服务端缓存选型:Redis vs 内存",
  "mode": "debate",                        // "roundtable" | "debate"
  "status": "paused",                      // "active" | "paused" | "completed"
  "maxRounds": 3,
  "currentRound": 2,                        // 已完成的轮数
  "createdAt": "2026-07-29T12:00:00Z",
  "participants": [
    {
      "handle": "claude-architect",         // transcript 中的发言者名
      "provider": "claude",                 // adapters 注册名
      "transport": "local",                 // MVP 恒为 "local";v2 预留 "ssh:<host>" / "guest"(入站客座)
      "perspective": "architect",           // 模板 id 或 {"custom": "..."}
      "model": null,                        // 可选覆盖
      "sessionRef": "a1b2-...",             // provider 定义的续接引用(id 或路径)
      "tokens": { "input": 0, "output": 0 } // 累计,尽力采集
    }
  ]
}
```

### transcript.jsonl(追加式,seq 严格递增,单写者=runner)

```jsonc
{ "seq": 1, "ts": "...", "kind": "system",  "round": 0, "body": "话题开启…charter 摘要" }
{ "seq": 2, "ts": "...", "kind": "message", "round": 1, "from": "claude-architect", "body": "…", "stance": "【立场】…" }
{ "seq": 5, "ts": "...", "kind": "human",   "round": 1, "from": "cecil", "body": "补充一个约束…" }
{ "seq": 9, "ts": "...", "kind": "verdict", "round": 4, "from": "codex-judge", "body": "裁决…" }
{ "seq": 10, "ts": "...", "kind": "round_end", "round": 1 }
```

- **单写者原则**:transcript.jsonl 只由 runner 追加(human 事件也是 runner 从 inbox 搬运后写入),避免 Windows 下双进程并发追加同一文件的交错风险。
- attach 写 `inbox.jsonl`(自己的追加文件);runner 在每次发言间隙消费 inbox → 写成 transcript 的 `human` 事件;attach 视图渲染时合并 transcript + inbox(未消费的插话即时可见,标记 pending)。消费进度落在 runner 独占的 `inbox.cursor`(tmp+rename 原子写),保持每个文件单写者。
- ⚠️ 步骤 8 待拍板(check 上报):多个 attach 并发插话时 inbox id"读末条再追加"跨进程非原子,可能重复 id 导致漏消费。TUI 实现时二选一:限单 attach 写入,或 id 改为时间戳+随机后缀。

### runner.lock

`{ pid, startedAt }`。runner 启动时检测:存活 pid → 拒绝双跑;死 pid → 视为崩溃残留,接管并清理。SIGINT:置 `stopRequested`,当前参与者发言完成后写状态、清锁、退出(“安全边界”=单次发言之间,而非整轮)。

## 3. Provider 适配器契约

```ts
interface SpeakResult { text: string; sessionRef: string; tokens?: { input?: number; output?: number } }
interface ProviderAdapter {
  name: string;                                  // "claude" | "codex" | "opencode" | "reasonix" | "mock"
  detect(): Promise<{ ok: boolean; version?: string }>;   // doctor 用
  speak(opts: {
    prompt: string;
    sessionRef?: string;        // 缺省 = 新会话
    model?: string;
    cwd: string;                // 话题目录(不是代码仓库——讨论不需要项目上下文,也隔离了各 CLI 的仓库注入,压 token)
    timeoutMs: number;
  }): Promise<SpeakResult>;
}
```

各家实现要点(命令锚点已在步骤 4 真实调用实测确认,四家记忆续接全部跑通 2026-07-30):

| provider | 新会话 | 续接 | sessionRef 捕获(实测) | 输出解析 |
|---|---|---|---|---|
| claude | `claude -p --output-format json --tools ""` | `--resume <id>` | JSON 结果的 `session_id`(UUID) | JSON `result` 字段 |
| codex | `codex exec --json -s read-only --skip-git-repo-check` | `codex exec resume <id> --json`(⚠️ resume 不认 `-s`,改 `-c sandbox_mode="read-only"`) | `thread.started` 事件的 `thread_id`(UUIDv7) | JSONL 最后 agent message;兜底 `-o` 落盘 |
| opencode | `opencode run --format json`(model 覆盖走 `-m <p/m>`) | `-s <sessionID>` | 事件顶层 `sessionID`(`ses_...`) | JSON 事件流取正文 |
| reasonix | `reasonix run --max-steps 2`(经 node 直跑 bin,见下) | `--resume <path>` | 运行前后 diff sessions 目录取新增 jsonl **绝对路径**;`--resume` 追加写同一文件,路径跨轮稳定;兜底哨兵 `@last` 走 `-c` | stdout 纯文本(剔 ANSI/`▎ thinking`/`· codegraph:`/`· N tok ·` 尾行) |

- reasonix 会话文件位置:`%APPDATA%\reasonix\projects\<cwd 路径按 [:\/]→- 转写>\sessions\<时间戳>-<model>.jsonl`。
- 子进程统一经 `src/adapters/exec.ts`(spawn、prompt 走 stdin 防 Windows 引号/编码问题、超时杀进程、`ProviderExecError` 结构化错误含 stderr 摘要、windowsHide)。
- ⚠️ reasonix 双装坑:本机 scoop 有旧版 `reasonix.exe`(1.17.21),Node 直接 spawn 会误命中;正确入口是 npm 版 `reasonix.ps1`(1.8.0-rc.1)。经 `pwsh -NoProfile -Command "(Get-Command reasonix).Source"` 解析出 ps1 后,**直接 spawn `<basedir>\node.exe` 跑 `bin/reasonix.js`**(ps1 内部实际命令),绕开 pwsh 管道对中文 stdin 的 GBK 编码破坏,且超时能杀准真实进程。解析结果缓存;解析到非 ps1 则抛错。
- 讨论场景不需要写文件:各 CLI 以只读/受限模式运行(claude `--tools ""`、codex `-s read-only`(resume 走 `-c sandbox_mode`)、opencode 默认、reasonix `--max-steps` 压到最小),既安全又省 token。
- **mock provider**:从脚本文件读取预设发言,速度快、确定性,支撑引擎 e2e 测试与 TUI 开发。

## 4. 回合引擎与 prompt 组装

每位参与者一次发言的 prompt(prompt.ts 统一组装):

```
[charter 全文]                    ← 每次都带(话题、参与者名单与视角、模式规则、停止条件)
[历史立场摘要]                    ← 第 1..n-2 轮:每人每轮一行【立场】(从发言尾部提取)
[上一轮发言全文 + 未消费的人类插话]
[你的身份与视角说明]
[发言协议] 请发表本轮观点…正文末尾必须输出一行:【立场】<一句话立场>
```

- token 控制:全文只保留最近一轮,更早轮次压缩为立场行;这是零额外模型调用的 digest(借鉴 agentparty digest 思想)。发言者漏写【立场】时,退化为正文前 120 字截断。
- **roundtable 模式**:固定顺序 round-robin,maxRounds 轮后写 `round_end` + 状态 completed,并让最后一位参与者(或 charter 指定者)输出总结作为 summary.md。
- **debate 模式**:参与者按 charter 分为立场方(视角模板注入对抗指令);maxRounds 轮交锋后追加**裁决轮**——由 charter 指定的裁决者(默认第一位参与者换一个"裁决人"身份的新会话,避免立场污染)输出结构化裁决(结论/关键论据/分歧点/风险),写 `verdict` 事件并生成 summary.md。
- loop guard(借鉴):除轮数上限外,若连续 2 轮所有参与者立场行与上一轮完全相同,提前收尾并注明“已收敛”。
- 人类锚点熔断(借鉴 agentparty 服务端 loop guard):话题可配 `humanAnchorEvery`(默认关闭);连续 N 轮无 human 事件时 runner 自动暂停等人插话,防止长讨论失去人类锚点。
- 发言协议允许 `【跳过】`:参与者本轮无信息增量时输出跳过标记,runner 记 `skip` 事件不计正文;连续全员跳过按收敛处理。圆桌模式防"收到/好的"式水贴。

## 5. attach TUI(Ink)

- 布局:`<History>`(滚动区,按参与者着色,human 插话高亮)/ `<StatusBar>`(话题、模式、轮次 x/y、runner 活跃状态(由 lock 判断)、累计 token)/ `<InputBox>`。
- 数据源:useTranscript = 初始全量读 + fs.watch(500ms 轮询兜底,Windows fs.watch 不可靠)合并 inbox。
- 输入回车 → 追加 inbox.jsonl → 本地即时显示(pending 标记),runner 消费后转正。
- 退出:q / Ctrl+C 仅退出视图。TUI 内 `:stop` 命令 = 写入 inbox 一条 `stop` 控制事件,runner 在安全边界结束话题。
- 兼容:仅要求 Windows Terminal / VS Code 终端级别的 ANSI 支持;Ink 官方支持 Windows,风险点在 raw mode 与中文宽度计算,MVP 接受轻微渲染瑕疵。

## 6. v2 预留边界:远程参与者

- **出站远程(ssh transport)**:participants 的 `transport: "ssh:<host>"`,adapter 的 `execProvider` 换成 SSH 执行封装即可,调度器与引擎不变。
- **入站客座(自建频道服务)**:`roundtable serve <topic>` 把 store 层(transcript+inbox)包上 HTTP/WS,消息契约借鉴 AgentParty(token 身份、seq 历史、loop guard)自实现;客座参与者为 `transport: "guest"`,回合引擎需为其增加每轮等待窗口(超时记跳过)。MVP 不实现,但 store 层 API 保持"可被服务层包裹"的纯函数形态,不直接依赖进程内状态。

## 7. 兼容与迁移

- 所有 CLI 旗标集中在各 adapter 文件顶部常量,版本漂移只改一处;doctor 输出各家版本供排查。
- topic.json 带 `version` 字段;后续 schema 演进写迁移函数。
- 迁出仓库:目录自包含(不 import 仓库其他包);tsconfig extends 仓库 base 是唯一耦合,迁出时内联即可。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| codex/reasonix 的 session 引用捕获字段与文档不符 | 实现顺序上适配器最先做,真实调用各跑一次确认;每家 adapter 有独立集成 smoke 脚本 |
| Ink 在 Windows 的输入/渲染坑 | TUI 放在引擎跑通之后做;保底方案(纯流式 show --follow)作为 debug 通道顺手保留 |
| 双进程并发写文件 | 单写者原则 + inbox 分离(见 §2) |
| token 失控 | 立场摘要压缩 + cwd 指向话题目录隔离仓库上下文 + doctor/status 展示累计 token |
| 各 CLI 权限提示阻塞 headless | 讨论均为只读会话,按 §3 各家用只读/无工具模式;smoke 脚本验证无交互挂起 |
