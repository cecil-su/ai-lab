# 执行计划 — roundtable 接触代码·续谈·token增量

工作目录 `lab/agent-roundtable/`。顺序按"低风险先行 + 建信心",四项低耦合可独立提交/回滚。每步跑 `pnpm -F agent-roundtable typecheck` 与相关单测。

## 通用校验命令

```bash
pnpm -F agent-roundtable typecheck
pnpm -F agent-roundtable test          # vitest 全量
pnpm -F agent-roundtable build         # 冒烟前需 dist
```

## 步骤

### S1 — R1 注入(先行,解锁自举)
1. `charter.ts`:`CharterInput` 加 `contextMaterial?: string`;`buildCharter` 在参与者段后插 `## 参考材料` 段。
2. `commands.ts` `cmdNew`:解析 `--context-file`(csv)/`--context-dir`(+`--context-glob`);读文件、拼材料、体积守卫(`CONTEXT_MAX_BYTES` 默认 200KB,超限 warn+清单不 fail);路径不存在报错中止;传 `contextMaterial` 给 `buildCharter`。
3. 更新 `cmdNew` 用法字符串与 README 对应段。
- **verify**:新增 charter 单测(给 contextMaterial → 断言含 `## 参考材料` 与内容);mock 引擎端到端断言注入内容出现在参与者 prompt 中。typecheck + test 绿。
- **rollback point**:S1 可独立 commit(`feat(roundtable): --context-file/--context-dir 注入参考材料`)。

### S2 — R4a 测量(cache_read 单列)
1. `adapters/types.ts`:`SpeakResult.tokens` → `{ input?, cached?, output? }`。
2. 四家 parse 按 design §4a 拆分;各补/改一发 fixture 单测覆盖新拆分。
3. `store/topic.ts`:`Participant.tokens` → `{ input, cached, output }`;`createTopic` 初值三零;`loadTopic` 旧话题缺 `cached` 默认 0。
4. `runner.ts` `speakOnce`/`updateParticipant`:累加三路。
5. `commands.ts` `listView` / `--json`:展示三者;`mock.ts` 同步 tokens 形状。
- **verify**:四家 parse 单测断言 input/cached/output 分离;list `--json` 快照含三字段;旧 topic.json fixture 读入 cached=0。typecheck + test 绿。
- **rollback point**:S2 独立 commit(`feat(roundtable): token 计数区分 input/cached/output`)。

### S3 — R4b 增量 prompt + R4c 旋钮
1. `prompt.ts`:加 `deltaContext(events, lastOwnSeq)` 或给 `promptContext` 增模式;`buildPrompt` 支持 `mode: full|delta`,delta 只渲染新事件 + 一行身份 + protocol,不含 charter/历史摘要。
2. `runner.ts` `speakOnce`:算 `lastOwnSeq`(max seq where from===handle);`sessionRef 存在 且 lastOwnSeq 存在` → delta,否则 full;sessionRef 降级退回 full。
3. R4c:`QUOTE_MAX_CHARS` 截断引用;`protocol()` 加输出长度上限提示。
- **verify**:mock 端到端——首轮 prompt 含完整 charter;续接轮 prompt **不含** charter 段、**含**上一轮新增发言;多轮累计"新增 input"显著低于全量基线(mock 计数比较断言)。typecheck + test 绿。
- **rollback point**:S3 独立 commit(`feat(roundtable): resume 只发增量 prompt,压制 token 膨胀`)。

### S4 — R3 续谈(方案 B)
1. `commands.ts` `cmdContinue`:completed 且有 `--ask`/`--more` → 重开(`maxRounds += --more??1`、status active、saveTopic;`--ask` 走 `appendInbox` human);completed 无 flag → 拒绝并提示;paused 走原逻辑。支持 `--as`。
2. `runner.ts:105` 守卫**保留**(design §3 说明)。
3. 更新 `cmdContinue` 用法串与 README。
- **verify**:mock 端到端——completed 话题 `continue --ask` 后 transcript 追加 human 事件 + 新一轮(seq 连续),summary.md 重生成;paused 续接回归测试不变。typecheck + test 绿。
- **rollback point**:S4 独立 commit(`feat(roundtable): completed 话题可 --ask 续谈`)。

### S5 — R2 自读(真机重头,放最后)
1. `store/topic.ts`:`Topic` 加 `repo?: string`;`createTopic` 存 `path.resolve`;`loadTopic` 容忍缺失。
2. `commands.ts` `cmdNew`:`--repo` 解析入 topic。
3. `adapters/types.ts`:`SpeakOptions` 加 `codeAccess?: boolean`;`mock.ts` 同步签名。
4. `runner.ts` `speakOnce`:`cwd: topic.repo ?? dir`,`codeAccess: !!topic.repo`。
5. `adapters/claude.ts`:`codeAccess` 时改只读工具集(实机敲定 flag,更新顶部锚点注释);非 codeAccess 保 `--tools ""`。codex/opencode/reasonix 不改参数。
- **verify(单测)**:claude adapter 参数断言——codeAccess=true 不含 `--tools ""`、含只读工具;false 时回归 `--tools ""`。未设 repo 时 speak cwd=话题目录(runner 测)。
- **verify(冒烟,必做)**:`--repo <本仓库>` 开题,codex 发言引用真实代码;claude 只读模式跑通;reasonix 会话目录副作用核对一次。
- **rollback point**:S5 独立 commit(`feat(roundtable): --repo 让参与者只读自读代码`)。

### S6 — 收尾集成
1. README 汇总四项用法 + token 说明。
2. 更新 spec `.trellis/spec/guides/cli-subprocess-integration.md`:claude 只读 flag 锚点、reasonix cwd 副作用结论。
3. 全量 typecheck + test;最终真机冒烟:claude+codex 两家跑一场"注入 + 自读 + 一次续谈"的 debate。
- **rollback**:各步已独立 commit,可按 S1..S5 逐个 revert。

## 复用/避免重复
- 续谈复用现有 inbox→drainInbox→human 事件链,**不新造机制**。
- 增量 prompt 的 lastOwnSeq **从 transcript 派生**,不加持久字段。
- 注入零 adapter 改动(靠 charter 已入 prompt 的既有链路)。

## 审查门
- S2/S3 改契约(tokens 形状、prompt 形状),提交前确认 mock 与全部现存单测同步更新、无回归。
- S5 涉真机与 claude 权限,冒烟未过不算完成(prd AC)。
