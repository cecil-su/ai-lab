# Roundtable 引擎不变量(并发与生命周期)

> **Purpose**: `lab/agent-roundtable` 的 runner / finalize / 锁 / 会话信任在并发、超时、崩溃、人工中断边界下必须守住的执行契约。来源:2026-07-30 并发与生命周期缺陷修复(6 条)。违反这些不变量会导致双持锁、串会话、重复裁决、无产物的伪完成。

---

## 不变量 1:`status==="completed"` ⇒ `summary.md` 必然存在

**契约**:任何把话题落到 `completed` 的路径,落盘前都要保证 `summary.md` 存在;失败/人工终止也要写一份**说明性** summary,不得留"无产物的伪完成"。

**三条落 completed 的路径都要覆盖**:
- runner 正常收尾:`selectMode(mode).finalize()` 产出正式 summary。
- runner 收尾失败(catch):**无条件覆盖写**兜底 summary —— 不是"存在即跳过"。续谈场景磁盘上有上一代旧 summary,本代失败若跳过写入,会把旧结论冒充本代结论。
- 无 runner 的 `stop`(`commands.ts` `cmdStop`):置 completed 前补写终止说明 summary。

**复用**:`writeFallbackSummary(dir, reason)`(`engine/modes.ts` 导出)统一"无正式结论"文案,失败兜底与 `cmdStop` 共用,防文案漂移。

### Wrong vs Correct

```ts
// ❌ 存在即跳过:续谈时旧 summary 被当本代结论保留
if (!fs.existsSync(summaryFile)) fs.writeFileSync(summaryFile, 失败文案);

// ❌ cmdStop 无 runner 直接翻状态,产出无 summary 的 completed
saveTopic(dir, transition(topic, "completed"));

// ✅ 无条件覆盖 / 补写后再落 completed
writeFallbackSummary(dir, `收尾失败:${errText(err)}`);
// cmdStop:
if (!fs.existsSync(path.join(dir, "summary.md"))) writeFallbackSummary(dir, "经 CLI 人工终止,无正式结论。");
saveTopic(dir, transition(topic, "completed"));
```

**测试点**:`engine.e2e`(finalize 失败仍写兜底、内容为"无正式结论")、`finalize-fixes`(失败覆盖旧 summary)、`commands`(cmdStop 无 runner → completed 且有 summary)。

---

## 不变量 2:sessionRef 结构化 + 走增量续接前必经 `canResume` 闸门(ADR 0032)

**契约**:`sessionRef` 是结构化 `SessionRef {provider,value,trust,resumable}`,**不是裸 string**。归属(provider)与信任(trust/resumable)在**捕获时刻**由 adapter 确定,不在 runner/finalizer 里靠字符串重推。

- 构造子 `makeVerified`/`makeDegraded` 与 `SessionRef` 类型同处 `adapters/types.ts`(下游);策略 `canResume` 与迁移 `fromLegacy` 在 `engine/session-trust.ts`。**adapters 只向下依赖 types,不 import engine**(层级方向)。
- 任何把 ref 交给 adapter 走增量的地方(普通轮 `runner.ts` speakOnce、`finalize` `modes.ts`)都先过 `canResume(ref)`(= `trust==="verified" && resumable`);不可信传 `undefined`(全量新会话)。**adapter 内不再二次判 trust**——`if (sessionRef)` 即可,信任闸门唯一在 runner。
- reasonix 捕获:唯一归属 → `makeVerified`,歧义 → `makeDegraded`(#4)。收尾失败 `clearSession` 作废 ref。
- 磁盘迁移:`topic.json` v1 裸字符串 sessionRef 在 `loadTopic` 一处经 `fromLegacy(providerBase(provider), raw)` 升 v2(`@last`→degraded,其余→verified)。

### Wrong vs Correct

```ts
// ❌ 裸 string,信任散在各处重推;finalize 直传绕过闸门 → reasonix 续错线程
sessionRef: summarizer.sessionRef ?? undefined,
// ❌ adapter 内再判一次 trust,与兄弟 adapter 不一致
if (sessionRef?.resumable) args.push("--resume", sessionRef.value);

// ✅ 结构化 + 统一闸门;adapter 只认 value
sessionRef: canResume(summarizer.sessionRef) ? summarizer.sessionRef! : undefined,
if (sessionRef) args.push("--resume", sessionRef.value);
```

**测试点**:`finalize-fixes`(degraded 拦下传 undefined)、`reasonix-session`(单文件 verified / 歧义 degraded)、`topic`(v1 裸串迁移)、`mock-adapter`/`adapters-parse`(结构化 ref)。

> **Warning**:构造子放 `adapters/types.ts` 是为了让 adapters 自包含、engine 严格向下依赖;别把 `makeVerified` 放回 engine 再让 adapters 反向 import。

---

## 不变量 3:finalize 崩溃幂等 —— `finalization generation` 显式阶段标记(ADR 0030)

**契约**:收尾横跨多次文件写(append verdict/写 summary/落 completed),中途崩溃会留下分叉态。用 `topic.json` 的 `finalization:{generation,phase}` 把"收尾进度"收敛到**一处显式状态**,使恢复确定而非靠猜:

- runner 收尾:进 finalize 前置 `phase:"pending"`(generation 每次进入收尾自增,续谈按代);summary 落盘后置 `summary-written`;落 completed 时置 `done`。
- **恢复守卫**:runTopic 入口若 `finalization.phase !== "done"`(且非 completed)→ `recovering=true`,**跳过整个交锋循环**(避免收敛提前结束时重跑轮次),直接进收尾恢复:
  - `summary-written` → summary 已产,只补 `completed`+`done`,**不重跑收尾**。
  - `pending` → 沿用本代 generation 重跑 finalize;debate 由 #6 的 verdict 幂等键(transcript 已有本代 verdict 则据其重建、不再调裁决人)保证不二次裁决。
- fresh 收尾(phase 缺省/`done`)自增新代;`done` 表示上代已完成,续谈重开视作 fresh。

**测试点**:`finalize-fixes`(summary-written→不重跑;pending+verdict→据其重建不二裁;pending 无 verdict→补裁一次;无 finalization→fresh 收尾落 done)。

---

## 不变量 4:runner / attach 锁用 `openSync(...,"wx")` 原子占坑

**契约**:锁的获取必须是**原子占坑**(`O_EXCL`),不是 `readLock`-then-`write` 的 TOCTOU —— 后者两个并发进程可同时判"无锁"并都写成功,造成双持(重复 seq、互相覆盖 topic.json)。

**空占坑窗口(必须处理)**:`openSync(wx)` 建的是空文件,`writeSync` 写 pid 之间有跨进程读窗口。并发者读到空文件时**必须让步(占坑者正在建档)而非删除**,否则会误删刚抢到的锁 → 双持。仅"空文件超龄(占坑后崩溃)"才清理重试。

- 保留原语义:存活他人 pid → 拒绝;死 pid / 坏锁 → 崩溃残留,删后重试(至多有限轮)。
- attach 锁同构(`tui/attach.tsx`),保证 inbox 写者唯一。

### Wrong vs Correct

```ts
// ❌ TOCTOU:两个进程都读到"无锁"再各自写 → 双持
const existing = readLock(dir);
if (!existing || !alive(existing)) writeJsonAtomic(file, mine);

// ✅ 原子占坑 + 空文件让步
const fd = fs.openSync(file, "wx");      // 已存在即 EEXIST
try { fs.writeSync(fd, JSON.stringify(mine)); } finally { fs.closeSync(fd); }
// EEXIST 分支:空文件且未超龄 → 让步(不删);死 pid/坏锁 → 删后重试
```

**测试点**:`lock-race`(N 真实子进程同刻抢锁恰 1 成功;worker_threads 共享 pid 无法复现,必须多进程)。

---

**Core Principle**: completed / lock / sessionRef 都是被全局依赖的终态与凭证——它们的产生必须在并发、超时、崩溃、人工中断下都成立,不能只在 happy path 成立。
