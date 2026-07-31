# roundtable 参与者接触代码·续谈·token增量策略

## Goal

给 `lab/agent-roundtable/` 的圆桌 CLI 补四项能力,使它能**自举讨论自身代码的多维缺陷**:让参与者接触到被评审的代码(两条互补路线)、让一场讨论在收尾后还能被追问继续、并抑制 input token 随轮数累积膨胀。产物仍是本机自持 CLI,不引入外部服务。

## Background

- 前置任务已交付完整 roundtable CLI(归档:`.trellis/tasks/archive/2026-07/07-29-agent-roundtable-cli/`;分支 `feat/agent-roundtable-cli`,commit `0aeadb4`)。四家 headless 适配器 + 圆桌/辩论两模式 + 持久化 + Ink TUI + 6 视角 + doctor,61 单测全绿。
- 当前缺口(已查代码确认):
  - 参与者**读不到代码**。claude 用 `--tools ""` 禁全部工具(`src/adapters/claude.ts:9`);runner 把 speak 的 `cwd` 写死成话题目录而非代码仓库(`src/engine/runner.ts:224`)。
  - completed 话题**无法再续**(`src/engine/runner.ts:105` 完成态直接 return;`src/commands.ts:162` `continue` 拒绝 completed)。
  - input token **累积膨胀**:`buildPrompt` 每轮重发 charter 全文(`src/engine/prompt.ts:70`),`--resume` 的会话又把每份重发都存下,charter 在每家 jsonl 里出现 N 次。adapter 把 `input+cache_read+cache_write` 合并计数(`src/adapters/claude.ts:44`),掩盖了"纸面 token 大 vs 实际计费"的差别。
- 驱动用例:跑一场四家 debate 审查 roundtable 自身缺陷 → Claude 总结 → 与用户决定是否续谈深入(不盲盒开跑,见记忆 `debate-council-preflight-confirm`)。

## 约束与已定决策(用户拍板 2026-07-30)

- C1. 沿用前置任务全部约束:不依赖 trellis CLI/包,不引入外部服务,工具目录可整体迁出仓库;适配器只封装本机 CLI 子进程,不管理任何密钥。
- D1. **两条接触代码路线都要**,互补而非二选一:
  - 注入 = "把材料递到面前":定量、人人可读(含被禁工具的 claude)、对齐。
  - 自读 = "钥匙给你自己翻":开放探索、能力真实、只读放开。
- D2. **续谈取方案 B(同话题原地延续)**:completed 可重开,`maxRounds` 加轮,把用户追问作为 `human` 事件插入 transcript,各 AI 仍 resume 原会话。数据全部留在原 `topics/<id>/` 目录,不生新话题;换议题应另开 `new`。
- D3. **token 策略走推荐路径 D→A→B/C**:先把 cache_read 单列(测量,看清真相)→ 再上"resume 只发增量 prompt"(结构性解)→ B(压 recent 窗口)/C(卡输出长度)作补充旋钮。不丢 `--resume`。
- D4. 环境坑沿用 spec `.trellis/spec/guides/cli-subprocess-integration.md`:reasonix 双装须经 pwsh 解析 npm 版 ps1 再直跑 node bin;codex resume 走 `-c sandbox_mode`;prompt 一律 stdin。

## Requirements

- **R1 注入(context injection)**:`roundtable new` 新增 `--context-file <a,b,...>`(csv 路径)与 `--context-dir <dir>`(可选 `--context-glob <pat>`)。开题时读取这些文件,拼进 charter 的 `## 参考材料` 段(charter 每轮随 prompt 发给每位参与者,故四家全部可读)。总量设上限并在超限时告警 + 打印注入文件清单与体积。
- **R2 自读(self-read)**:`roundtable new` 新增 `--repo <path>`(绝对/相对代码仓库路径,存进 `topic.json`)。发言时该话题的子进程 `cwd` 指向 `--repo`;给有文件工具的参与者开**只读**:claude 把 `--tools ""` 换成只读工具集(放开 Read/Grep/Glob 或 `--permission-mode plan`),codex 已 `-s read-only`、opencode/reasonix 已带读工具只随 cwd 生效。未设 `--repo` 时行为与今日一致(cwd=话题目录、claude 仍禁工具)。
- **R3 续谈(方案 B)**:`roundtable continue <id> --ask "<追问>" [--more <n>]` 允许对 **completed** 话题重开:状态 completed→active、`maxRounds += n`(默认 +1)、把 `--ask` 作为一条 `human` 事件追加进 transcript,续跑后按完整 transcript 重生成 summary.md。各参与者 `sessionRef` 保留。不给 `--ask` 时退化为纯加轮。
- **R4 token 增量策略**:
  - R4a(测量):adapter 计数把 **cache_read 单列**,`SpeakResult.tokens` / `topic.json` / list 视图能区分"新增 input / 缓存读 / 输出",不再把三者混计为一个 input 数。
  - R4b(增量 prompt):participant 记"已读到的 seq";`--resume` 续接轮的 prompt 只发该 seq 之后的新增事件 + 发言协议,**不再重发 charter 与旧历史**;新会话(首轮 / sessionRef 降级兜底)才发完整 charter。
  - R4c(旋钮,补充):recent 引用按每条字数上限截断;发言协议加输出长度上限提示。

## Acceptance Criteria

- [ ] `roundtable new --context-file <README+design>` 开题后,charter.md 含 `## 参考材料` 段且内容为所给文件;mock 引擎端到端测试断言注入内容出现在发给参与者的 prompt 中。
- [ ] `roundtable new --repo <本仓库>` 开题,codex 参与者在发言中能引用仓库内真实代码(真机冒烟);claude 在 `--repo` 下不再是 `--tools ""`,而以只读工具集运行(参数断言 + 冒烟)。未设 `--repo` 时 cwd 仍为话题目录、claude 仍 `--tools ""`(回归)。
- [ ] 一场 debate 跑到 completed 后,`continue <id> --ask "针对X再深入"` 能重开:transcript 追加一条 human 事件与新一轮发言(seq 连续),summary.md 被重生成;各参与者发言可引用重开前内容(会话记忆延续,真机冒烟)。旧 `continue`(paused 话题)行为不回归。
- [ ] adapter 单测:四家的 parse 函数分别产出区分 `input`/`cacheRead`/`output` 的结构;list `--json` 视图能显示三者。
- [ ] 增量 prompt:mock 端到端断言——续接轮 prompt **不含** charter 段、**含**上一轮新增发言;首轮 prompt 含完整 charter。连续多轮的累计"新增 input"显著低于全量重发基线(以 mock 计数比较)。
- [ ] `pnpm -F agent-roundtable typecheck` 与全部单测绿;真机冒烟至少覆盖 claude + codex 两家(注入路线 + 自读路线 + 一次续谈)。

## Out of Scope

- 方案 C(派生 followup 新话题)、续谈的旧 summary 快照归档。换议题用 `new`。
- 后台 daemon、远程参与者(仍是前置任务 v2 范畴)。
- opencode/reasonix 的只读权限深度加固(MVP 依赖其默认只读/带读工具即可;若默认可写,记 spec 待后续收紧,不在本任务展开)。
- token 策略里丢弃 `--resume` 的无状态重建路线(已评估,更贵,不采纳)。
- API 直连 provider、注入内容的自动摘要压缩(R1 仅原样注入 + 体积告警,不做智能压缩)。
