# 技术设计 — roundtable 接触代码·续谈·token增量

对既有 `lab/agent-roundtable/` 的增量改造。四项彼此低耦合,可分别实现/验证。文件锚点均为改造前现状。

## 0. 触点总览

| 项 | 主要改动文件 | 性质 |
|---|---|---|
| R1 注入 | `commands.ts`(cmdNew)、`engine/charter.ts`(buildCharter) | 纯增,零 adapter 改动 |
| R2 自读 | `store/topic.ts`(+repo)、`engine/runner.ts`(cwd 路由 + codeAccess)、`adapters/types.ts`、`adapters/claude.ts`(只读工具集) | adapter 契约 +1 字段 |
| R3 续谈 | `commands.ts`(cmdContinue)、`engine/runner.ts`(完成态守卫) | 复用 inbox/human 机制 |
| R4 token | `adapters/types.ts`、四家 parse、`store/topic.ts`(tokens 形状)、`engine/prompt.ts`+`runner.ts`(增量) | 契约变更 + 兼容读 |

---

## 1. R1 注入(context injection)

**数据流**:`cmdNew` 解析 `--context-file`(csv)/`--context-dir`(+`--context-glob`)→ 读取文件 → 组装 `## 参考材料` 文本 → 传入 `buildCharter({..., contextMaterial})` → 写进 `charter.md`。`buildPrompt` 已把 charter 全文投喂每次发言(`prompt.ts:70`),故四家(含 `--tools ""` 的 claude)天然可读,无 adapter 改动。

**契约**:`CharterInput` 增可选 `contextMaterial?: string`;`buildCharter` 在参与者段后、停止条件前插入:
```
## 参考材料
> 以下为被评审材料,供讨论引用(只读)。

### <相对路径或文件名>
```<lang 猜测或空>
<文件内容>
```
```

**体积守卫**:累加注入字节,超过 `CONTEXT_MAX_BYTES`(常量,默认 200KB)时 **warn 不 fail**——`console.error` 打印每文件路径+体积+总量与"将显著增加每轮 token"提示,仍继续开题(是否收手交用户)。目录展开用 `fs.readdirSync` + 可选 glob(极简:无 glob 时取目录内文件,不递归;有 glob 用现成极简匹配或 `node:fs` glob——实现期定,避免引第三方)。

**边界**:注入是原样嵌入,不做摘要压缩(Out of Scope)。路径不存在 → 报错中止开题。

---

## 2. R2 自读(self-read)

**topic.json**:`Topic` 增可选 `repo?: string`(开题时 `path.resolve` 存绝对路径)。`loadTopic` 对旧话题缺字段容忍(`repo` 为 undefined = 旧行为)。

**cwd 路由**:`speakOnce`(`runner.ts:224`)将 `cwd: dir` 改为 `cwd: topic.repo ?? dir`。**未设 repo 时逐字节等价今日行为**(cwd=话题目录)。

**只读能力**:`SpeakOptions` 增 `codeAccess?: boolean`;runner 按 `codeAccess: !!topic.repo` 传入。各家:
- **claude**:`codeAccess` 时**不发** `--tools ""`,改为只读工具集。提案 `--allowedTools Read Grep Glob` 并叠加 `--permission-mode plan` 兜底禁写;**确切 flag 组合以实现期真机冒烟为准**(2.1.220),锚点更新回 `claude.ts` 顶部注释与 spec。非 codeAccess 保持 `--tools ""`(回归)。
- **codex**:已 `-s read-only` / `sandbox_mode="read-only"`,无参数改动,cwd 生效即可读。
- **opencode / reasonix**:已带读工具,cwd 生效即可读;其默认是否可写不在本任务加固(Out of Scope,记 spec)。

**兼容**:`codeAccess` 可选,mock 与旧调用不传即 false;types 变更需同步 mock adapter 签名。

**副作用核对**:reasonix 会话目录按 cwd 键控(`reasonixSessionsDir`),cwd 从话题目录改为 repo 后,同一 repo 下多话题的 reasonix 会话落同一 projects 目录——会话文件按时间戳命名、resume 用绝对路径,**不冲突**;`captureSessionRef` 的 before/after 差集逻辑不受影响。冒烟验证一次。

---

## 3. R3 续谈(方案 B,同话题原地延续)

**重开路径**(`cmdContinue`):当话题为 `completed` 且带 `--ask` 或 `--more` 时:
1. `maxRounds += (--more ?? 1)`,`status: completed → active`,`saveTopic`。
2. 若有 `--ask`:`appendInbox(dir, { kind: "human", from: <--as 或 "user">, body: ask })`(**复用现有 inbox → drainInbox → human 事件**机制,单写者仍是 runner)。
3. 调 `runTopic(dir)`:`loadTopic` 得 active 态,`computeProgress` 得 `completedRounds=旧 maxRounds`,`startRound=旧+1`;每轮开头 `drainInbox` 把 `--ask` 落为 round=startRound 的 human 事件,进入 `recent` 被全员看到;跑到新 `maxRounds`;`finalize` 按**完整 transcript** 重生成 summary.md(debate 追加新裁决,覆盖旧 summary)。

**守卫改动**:
- `runner.ts:105` `if (status==="completed") return` **保留**——它防的是"对已完成话题重复 finalize";重开由 cmdContinue 先翻 active,不触此守卫。
- `commands.ts:162`:completed 且**无**重开 flag → 仍拒绝,提示改用 `continue <id> --ask/--more`;completed 且**有**重开 flag → 走重开路径。paused 话题走原逻辑(不回归)。

**数据位置**:全部留在原 `topics/<id>/`;transcript 连续追加、seq 递增;不生新目录(D2)。

**不给 --ask**:纯 `--more n` 退化为加轮(prd 已注明可能立即重收敛,属预期)。

---

## 4. R4 token 增量策略

### R4a 测量:cache_read 单列

**契约变更**(`adapters/types.ts`):
```ts
tokens?: { input?: number; cached?: number; output?: number };
// input = 本次新处理(全额计费)的 prompt token;cached = 缓存读(廉价复用);output = 生成
```
四家 parse 拆分(现状均把 cache 折进 input):
- claude:`input = input_tokens + cache_creation_input_tokens`(均本次新处理),`cached = cache_read_input_tokens`。
- codex:`input = input_tokens`,`cached = cached_input_tokens`。
- opencode:`input = tokens.input + cache.write`,`cached = cache.read`。
- reasonix:metrics 无缓存拆分 → `input = prompt_tokens`,`cached = 0`。

**存储/展示**:`Participant.tokens` 变 `{ input, cached, output }`;`loadTopic` 对旧话题缺 `cached` 默认 0(version 保持 1,加字段容忍读);runner 累加三路;`listView` / `--json` 展示三者;`printEvent` 无关。

### R4b 增量 prompt(结构性解)

**判定**:`speakOnce` 中,若 `participant.sessionRef` 存在 **且** 该 handle 在 transcript 里已有过自身发言(存在 lastOwnSeq)→ **增量模式**;否则(首轮 / sessionRef 缺失兜底)→ **全量模式**。lastOwnSeq 直接从 transcript 派生(`max seq where from===handle`),**不新增持久字段**。

**增量内容**:agent 经 `--resume` 已在自身 jsonl 里持有 charter 与它上次发言前的全部简报,故它**没见过的只有 lastOwnSeq 之后的事件**(本轮在它之前的发言、上轮它之后的发言、round_end、human 插话)。增量 prompt = 这些新事件正文 + 一行身份提醒 + 发言协议;**不含 charter、不含历史立场摘要**。

**改动**:
- `prompt.ts`:`buildPrompt` 增 `mode: "full" | "delta"`(或拆 `buildDeltaPrompt`)。delta 分支只渲染 `newEvents`(seq>lastOwnSeq 的 message/human/verdict/skip)+ 一行 `你是「handle」,视角:…` + protocol。
- `promptContext`:增量模式改为返回 `newEvents`(按 seq 过滤),或新增 `deltaContext(events, lastOwnSeq)`。
- `speakOnce`:算 lastOwnSeq → 选 mode → 组 prompt。

**正确性保证**:全量↔增量对 agent 可见信息**等价**——首轮全量给足 charter+身份;此后每轮增量只补它真没见过的。sessionRef 降级(reasonix `@last`、捕获失败)时退回全量,牺牲 token 换正确。

**收益核对(AC)**:mock 端到端下,连续 N 轮"新增 input"累计应显著低于全量重发基线(charter 只在首轮计一次)。

### R4c 旋钮(补充)

- recent/newEvents 每条引用按 `QUOTE_MAX_CHARS`(常量)截断,超长加"…"。
- 发言协议 `protocol()` 增一句输出长度上限提示(如"控制在 N 字内")。
两者为常量旋钮,低风险,随手加。

---

## 5. 兼容性与回归

- **旧话题可读**:`topic.json` 新增 `repo?`、`tokens.cached` 均为容忍缺失的可选读,version 不升。
- **未用新能力零变化**:不传 `--context-*` / `--repo` / `--ask`,行为逐字节等价今日(cwd=话题目录、claude `--tools ""`、全量 prompt)。
- **契约变更波及 mock**:`SpeakOptions.codeAccess`、`SpeakResult.tokens` 形状变更需同步 `adapters/mock.ts` 与相关单测。
- **测试策略**:parse 类改动走纯函数单测(每家一发 fixture 覆盖新 tokens 拆分);注入/续谈/增量走 mock 引擎端到端;R2 claude 只读 flag + 各家真机走冒烟(claude+codex 必测)。

## 6. Tradeoffs / 已否决

- 续谈方案 C(派生新话题):溯源更干净但改动大、上下文切两处,lab 阶段不值当,换议题用 `new`(prd Out of Scope)。
- token 丢 `--resume` 无状态重建:每轮缓存全 miss 更贵且丢个体思路,否决。
- R4b 用持久 `lastSeenSeq` 字段 vs 从 transcript 派生:选派生,免迁移、免多写一处状态,单一真相源仍是 transcript。
