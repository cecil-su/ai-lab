# Design — 架构加固 Phase-2

## ① status / outcome 拆分（store/topic.ts + engine/runner.ts + commands.ts + tui/render.ts）

**类型**(topic.ts):
```ts
export type TopicStatus = "active" | "paused" | "completed" | "cancelled"; // 不加 finalizing(③ 标记已覆盖)
export type TopicOutcome = "success" | "degraded" | "failed";
export interface Topic { ...; outcome?: TopicOutcome; ... }
```

**transition 表**:
```ts
active:    ["paused", "completed", "cancelled"],
paused:    ["active", "completed", "cancelled"],
completed: ["active"],   // 续谈重开
cancelled: ["active"],    // 取消后也可续谈重开
```
`transition` 仍只管 status;`outcome` 由调用点单独 set(不进 transition 表,避免笛卡尔积)。

**outcome 落点**(runner.ts 收尾,复用 Phase-1 ③ 的 finalization 段):
- 成功收尾(finalize 未抛):`outcome = topic.participants.some(p => p.failures > 0) ? "degraded" : "success"`。
- finalize 失败(catch 兜底):`outcome = "failed"`。
- 在 `summary-written` checkpoint 与最终 `done`+`completed` 中持久化 outcome。HEAD-era `summary-written` 若缺 outcome 一律保持 unknown;participant failure 与 finalizer failure 可能并存,不能可靠推导。

**cancelled**(commands.ts cmdStop 无 runner 分支):
- 现 `transition(topic, "completed")` → 改 `transition(topic, "cancelled")`;仍 `writeFallbackSummary`(cancelled 也维持"终态⇒summary")。
- with-runner 的 stop(经 inbox → runner finalize)仍走 completed(它确实产出了正式 summary),**不改**。cancelled 专指"无收尾的人工终止"。

**continue 重开**:completed/cancelled 均可显式 `→active`,但重开时必须清上一代 outcome;新一代 active/paused/cancelled 不得投影旧结果。`runTopic` 自身对两个终态都短路,避免 API 绕过 cmdContinue 静默重启 cancelled。

**展示**(render.ts:88 一带 + listView):
- completed:附已知 outcome —— `已完成` / `已完成·降级` / `已完成·失败`;缺省表示旧结果 unknown,只显示 `已完成`。
- cancelled:`已取消`。

**兼容加载**(topic.ts loadTopic):旧 completed 缺 outcome 一律保持缺省 unknown,不 bump version。

**权衡**:outcome 不进 transition 状态机(两轴正交,避免 4×3 爆炸,ADR 0031)。cancelled 与 completed 都可续谈,故都保留 `→active` 出边。

---

## ② capabilities 接策略层（commands.ts cmdNew + adapters/types.ts 注释）

**现状**(commands.ts:183-194):`--repo` 时对 inherited provider **仅 console.error 告警**,随后照常 createTopic。`adapters/types.ts` 注释写着"硬截止线:--repo 转正/v2 前须对 inherited 默认拒绝"。

**方案**:把告警升级为**默认拒绝 + 显式覆盖**:
- 复用现有 `inherited` 计算(:184-191)。
- 若 `repo` 且 `inherited.length > 0`:
  - **无** `--allow-unsafe-repo`:`console.error` 说明哪些 provider 未强制只读 + 指引(移除它们 / 换 enforced / 加 `--allow-unsafe-repo`),`return 1`,**不建话题**。
  - **有** `--allow-unsafe-repo`:保留现有那条实验特性告警,照常创建。
- 全 enforced(claude/codex)+ --repo:允许创建,但仍输出通用实验性披露——写权限受限不等于项目指令/plugin/hook 隔离。
- 更新 `adapters/types.ts` 的"硬截止线"注释为"已落地:inherited 默认拒绝,--allow-unsafe-repo 覆盖"。

**权衡**:策略只放在创建入口(cmdNew)一处——运行期不再重判(participants 一旦落盘即定)。flag 名 `--allow-unsafe-repo` 语义直白、默认安全。

---

## ③ exec TERM→KILL 优雅升级（adapters/exec.ts）

**现状**:`killTree(pid)` 直接 `treeKill(pid, "SIGKILL")`。provider 无优雅退出机会(冲刷缓冲/清子进程)。

**方案**:不能用“TERM 后对原 root PID 延迟重遍历”的 timer:根若先退出,忽略 TERM 的 detached 后代会 reparent 而逃逸,PID 复用还可能误杀无关进程。

POSIX 流程:
1. 首次读取进程表,捕获整树启动身份(Linux=`pid+/proc starttime tick`;其他 POSIX=`pid+ps lstart`)。外部查询设短 timeout,失败时走有界即时强杀兜底,不能把查询错误当作树已退出。
2. 先后代、后根发送 SIGTERM。
3. 宽限内轮询同一身份;同时吸收仍存活成员后来创建的后代。
4. 宽限结束后只对身份仍匹配的 survivors 发 SIGKILL,再做有界退出确认。
5. timeout / 流 error / overflow 都进入同一 `fail()`:清理开始即关 settled/输出累积,终止 Promise 完成后才 reject。

Windows 继续使用 tree-kill 的 `taskkill /T /F` 即时强杀;没有 POSIX 优雅期。整个清理过程有界,但不会留下独立的未取消 escalation timer。

---

## 迁移与回滚

- ①/②/③ 彼此低耦合(① topic/runner/commands/render;② commands cmdNew;③ exec),各独立提交/revert。
- ① 唯一磁盘影响是新增可选 outcome,loadTopic 一处兼容;无 version bump。

## 测试策略

- ①:正常→success、部分失败→degraded、finalize失败→failed、无runner stop→cancelled;重开清 outcome;cancelled engine guard;旧 completed 即使有 failures 也保持 unknown;render/list 只展示 completed outcome。
- ②:注入 resolver 走 cmdNew 全链路:inherited 无覆盖→非零且不建目录;覆盖→建成+告警;全 enforced→建成+通用非隔离披露。
- ③:覆盖根忽略 TERM、根退出但 detached 孙忽略 TERM、优雅退出、output overflow。所有失败断言 reject 后心跳已停止;Windows 只校验最终整树退出。
