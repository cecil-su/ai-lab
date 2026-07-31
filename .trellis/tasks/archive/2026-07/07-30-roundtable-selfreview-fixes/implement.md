# 执行计划 — P0 止血(F1 + F2)

工作目录 `lab/agent-roundtable/`。本轮只做 F1+F2。每步 `pnpm -F agent-roundtable typecheck` + 相关单测。

## 校验命令
```bash
pnpm -F agent-roundtable typecheck
pnpm -F agent-roundtable test
```

## 步骤

### S1 — F2 状态机(先做,后续 F1 的 finalize 兜底要用到确定态)
1. `store/topic.ts` `transition()`:`next === topic.status` 直接返回原 topic(幂等);`TRANSITIONS.completed = ["active"]`。
2. `engine/runner.ts`:开场 `active`、`paused`、`completed` 三处 status 改 `topic = transition(topic, ...)`。
3. `commands.ts` `cmdContinue` 续谈重开:`transition(topic, "active")` 替代直接改;`maxRounds` 仍单独设。
- **verify**:topic.test 加——幂等、completed→active 合法、completed→paused 抛;续谈 e2e/continue.test 不回归。

### S2 — F1 error 事件 + 降级
1. `store/transcript.ts`:`EventKind` 加 `"error"`。
2. `engine/runner.ts` `speakOnce`:`try adapter.speak catch` → 写 `error` 事件、返回 `{failed:true, event}`;`SpeechResult` 加 `failed?`。
3. runTopic 主循环:失败时不调 `updateParticipant`(保留旧 sessionRef/tokens),继续下一位。
4. `stanceMap`/`checkConverged`:`error` 与 `skip` 同档(归 `【跳过】`)。
5. `printEvent`(commands)与 `tui/render`:渲染 error 事件(如 `⚠ <from> 失败: <body>`)。
- **verify**:engine.e2e 加——mock 抛错的 provider 那轮写 error 事件、该参与者跳过、其余照跑、收尾 completed、status 落定;全体失败轮 → 提前收敛。

### S3 — F1 finalize 兜底 + --timeout
1. `runTopic`:`finalize` 包 try/catch,失败写 error 事件、status 仍 `transition(...,"completed")`。
2. `commands.ts`:`cmdNew`/`cmdContinue` 解析 `--timeout <秒>`(正整数→ms),传 `runTopic({ timeoutMs })`;更新用法串与 README。
- **verify**:mock 让 finalize provider 抛错 → status 仍 completed + 有 error 事件;`--timeout` 解析单测(非法值报错)。

### S4 — 收尾
1. 全量 typecheck + test 绿。
2. README 补 `--timeout` 与"单点失败不炸全场"说明。
3. 真机冒烟(F1 AC):构造一次真实超时(如极小 `--timeout 2` 跑一家真 CLI),验证该参与者记 error、讨论继续、不炸全场。
- **commit**:F2 一提交、F1(S2+S3)一提交,或合并为一个 `fix(agent-roundtable): 单点失败降级+超时可配+状态机走transition`。

## 复用/避免重复
- error 归并进既有 `stanceMap`/`checkConverged` 的 `【跳过】` 语义,不新造收敛路径。
- `--timeout` 走已存在的 `RunOptions.timeoutMs`,不新造传参链。
- status 全部经既有 `transition()`,不再散落直接改。

---

## F4 执行(①地基 + ②叠加;③终局不做)

### S5 — ① 可信判据 + 降级回退全量 + 告警
1. `engine/runner.ts` `speakOnce`:引入 `isTrustedRef(ref)`(非空且非 `REASONIX_LAST_SESSION` 等降级哨兵);delta 条件改为 `isTrustedRef(sessionRef) && ownSeq>0`;降级但 ownSeq>0 时走全量并 `emit` 一条告警事件(system,body 说明会话降级改全量)。
2. `adapters/reasonix.ts`:`REASONIX_LAST_SESSION` 已导出,直接复用;如需集中哨兵集合,在 runner 内维护常量列表。
- **verify**:单测——可信 ref → delta(prompt 不含 charter);`@last` → 全量(prompt 含 charter)+ 告警事件存在;构造"两 reasonix 同 cwd 其一 @last"的 e2e,断言该参与者本轮全量。

### S6 — ② transcript 资源行
1. `store/paths.ts`:加取 transcript 路径的工具(话题内相对/绝对)。
2. `engine/charter.ts`:`buildCharter` 可选接 `transcriptRef`,在 charter 末尾(停止条件前后)加 opt-in 资源段;缺省不加。
3. `commands.ts`/`runner.ts`:开题写 charter 时传 transcript 路径(无 --repo=话题内路径;有 --repo=绝对路径)。
- **verify**:charter 单测——传 transcriptRef 时含资源段与 opt-in 措辞、不含"每轮读取"指令;不传时无该段。

### S7 — 收尾
1. typecheck + 全量测试绿。
2. README 补"transcript 可按需自读"一句(附 ② 仅对有工具 provider 生效)。
3. commit:F4 一次(`fix(agent-roundtable): 降级会话回退全量防串会话 + transcript 按需可读`)。
- ③ 完全替换 resume+delta 记入 prd Out-of-Scope 演进方向,不实现。

---

## Phase A 执行(A2 > A1 > A5+slugify > A4;A3 不做)

### S8 — A2 inbox 并发可靠性(P0)
1. `store/lock.ts` 或新 helper:`withInboxLock(dir, fn)` —— `fs.openSync(inbox.lock,'wx')` 独占创建 + 毫秒自旋重试(上限 ~2s),`finally` unlink 释放;拿不到锁超时后 best-effort 执行 fn。
2. `store/inbox.ts`:
   - `readInbox` 改为容错逐行解析,条目带物理行号 `_line`;新增返回 `{entries, totalLines, badLineNos}` 的读函数。
   - cursor 改 `{lines:N}`;`consumedLines(dir)`(读旧 `{consumed:id}` 时迁移为 id<=consumed 的条目数);`markConsumed(dir, throughLines)` 取 max。
   - `readPending` 按 `_line > consumedLines` 过滤;`appendInbox` 包 `withInboxLock`(id 仍 last+1,仅作标签)。
3. `engine/runner.ts` `drainInbox`:消费 pending;对区间内 badLineNos emit `error` 事件(命名损失);`markConsumed(totalLines)`。
4.(收尾子项)attach TUI 送达态:插话后显示"已入 inbox",对应 human 事件出现翻"已送达"。
- **verify**:inbox 单测——并发多写(模拟交错)不丢 stop、坏行跳过并计数、cursor 行号迁移正确;e2e——坏行触发 error 事件且讨论继续。
- **commit**:`fix(agent-roundtable): inbox 行号水位线+写锁+坏行容错(A2)`。

### S9 — A1 失败可观测(P1)
1. `store/topic.ts`:`Participant.failures:number`(createTopic 初 0,loadTopic 容忍缺失)。
2. `engine/runner.ts`:每参与者连续失败计数(transient);失败累加 `failures`、成功清零;连续达阈值(常量默认 3)→ 自动 `transition(paused)` 落盘 + emit 损失评估 system 事件;**非 TTY 不提问**。
3. `commands.ts` `listView`/status:展示 failures,failures>0 时计量标"下界"(≥)。
- **verify**:e2e——构造某参与者连续失败达阈值 → 自动 paused + 损失评估事件;failures 计入且计量标下界;偶发单次失败不熔断。
- **commit**:`fix(agent-roundtable): 失败计数+连续失败熔断+诚实计量下界(A1)`。

### S10 — A5 + slugify(P2)
1. `engine/context.ts`:超 `CONTEXT_MAX_BYTES` 丢弃尾部文件 + 被裁清单写进材料段;`collectFiles` 支持 `--context-dir` 递归。
2. `engine/runner.ts`:开题 emit 一条 system 事件列出被裁文件(若有)。
3. `commands.ts` `slugify`:保留 CJK/字母/数字,折叠不安全字符与空白为 `-`,限长 60,空值回退 `topic`。
- **verify**:context 单测(超限裁剪+清单、递归收集);slugify 单测(中文标题产出可辨认非空 slug、限长);README 更新递归说明。
- **commit**:`fix(agent-roundtable): 注入硬裁剪+context-dir递归+slugify保留中文(A5)`。

### S11 — A4 能力声明(截止线前)
1. `adapters/types.ts`:`ProviderAdapter.capabilities?: {codeAccess:"enforced"|"inherited"}`;各 adapter 声明(claude/codex enforced,opencode/reasonix inherited)。
2. `commands.ts` `cmdNew --repo`:告警点名 inherited 的 provider。
- **verify**:单测——各 adapter capabilities 正确;--repo 告警含 inherited 名单。
- **commit**:`fix(agent-roundtable): adapter codeAccess 能力声明+点名(A4)`。

### 不做:A3(去 O(n²))—— 见 design,威胁模型不自洽 + 全量读兼 seq 校验,待基准。

## 复用/避免重复
- 写锁复用 `store/lock.ts` 思路,但短命 best-effort,不引 pid 接管。
- 熔断走既有 `transition`/paused 通路;失败计数复用 F1 的 catch 分支。
- slugify/context 改动集中在既有函数,不新造模块。
