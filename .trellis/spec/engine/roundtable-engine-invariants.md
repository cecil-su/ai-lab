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

## 不变量 2:走增量续接前必经 `isTrustedRef` 闸门(普通轮与 finalize 一致)

**契约**:任何把 `sessionRef` 传给 adapter 走增量(`--resume`/`-c`)的地方,都要先过 `isTrustedRef(ref)`;不可信则传 `undefined`(全量新会话)。

- `isTrustedRef` = 非空 **且** 不在降级哨兵集合(`DEGRADED_REFS`,含 reasonix `@last`)。抽在 `engine/session-trust.ts`,普通轮(`runner.ts` speakOnce)与 `finalize`(`modes.ts`)共用同一函数,避免两套口径。
- 收尾失败时,`clearSession(topic, handle)` 作废相关参与者的 ref,避免续谈带着可能失效/被污染的 ref 走增量。

### Wrong vs Correct

```ts
// ❌ finalize 直传,绕过闸门:ref 可能是 @last → reasonix -c 续错线程
sessionRef: summarizer.sessionRef ?? undefined,

// ✅ 与普通轮同一闸门
sessionRef: isTrustedRef(summarizer.sessionRef) ? summarizer.sessionRef! : undefined,
```

**测试点**:`finalize-fixes`(@last 被拦下传 undefined;可信 ref 透传)。

> **Warning**:`engine/session-trust.ts` 独立成模块是为了打破 `runner ↔ modes` 循环 import —— 别把 `isTrustedRef` 放回 runner 再让 modes 反向 import。

---

## 不变量 3:finalize 崩溃幂等 —— 已有 verdict 不重复裁决

**契约**:debate 收尾"append verdict 事件 → 写 summary → 落 completed"之间存在崩溃窗口(verdict 已落盘、status 仍 active)。恢复后重跑 `finalize` 必须先检测 transcript 里本代 verdict(`kind==="verdict"` 且 `round===currentRound+1`),已存在则**据其重建 summary、不再调裁决人**;否则重复/冲突裁决。

- 幂等键用 append-only transcript 里的 verdict 事件本身,不额外持久化"finalization 阶段"(lab 代码从简)。

**测试点**:`finalize-fixes`(预置 verdict+active → finalize 不调 adapter、据 verdict 重建;无 verdict → 正常裁决一次)。

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
