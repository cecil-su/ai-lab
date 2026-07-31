# agent-roundtable 架构加固 Phase-2(可观测性与监督)

## Goal

在 Phase-1 补齐"防错"不变量之后,Phase-2 补"可观测性与监督":让终态语义机器可读、让 --repo 的安全策略从"仅告警"升为"默认拒绝可覆盖"、让子进程终止先礼后兵。范围与顺序按架构评审复盘优先级(status/outcome=4、capabilities=5),外加 supervisor 的 TERM→KILL 增量项。

## Scope

| 项 | 来源 | 一句话 |
|----|------|--------|
| ① status/outcome 拆分 | ADR 0031 | `status` 加 `cancelled` + 新增 `outcome: success\|degraded\|failed`,把"结果如何"从 `completed` 里解耦 |
| ② capabilities 接策略层 | 评审点 5 后半 | `--repo` 下 inherited(非强制只读)provider 从"仅告警"升为"**默认拒绝** + `--allow-unsafe-repo` 覆盖" |
| ③ exec TERM→KILL | supervisor 增量 | `killTree` 先 SIGTERM 宽限、再 SIGKILL,给 provider 优雅退出机会(POSIX 生效;Windows 因 taskkill /F 仍即杀) |

**不在本任务(单列未来 phase)**:transcript 升为全量恢复源 / topic.json 降级为 projection(ADR 0030 第二阶段,大改动)。

## Constraints

- **不重构、不改目录模型**(ADR 0030)。
- **③ 与 Phase-1 的 finalizing 交互**:Phase-1 的 ③ 已用 `finalization:{generation,phase}` 标记对象处理收尾阶段,**故本任务 status 不再引入 `finalizing` 状态值**(ADR 0031 里那条已被标记对象覆盖),只加 `cancelled` + `outcome`。
- **磁盘兼容**:`outcome` 是新增可选字段,**不 bump version**。旧 `completed` 无 outcome 一律保持缺省 unknown;即使有累计 failures 也可能同时发生旧版 finalizer failure,不能可靠推导 degraded/failed。
- **Surgical**:①/②/③ 各可独立提交、独立 revert。
- **测试先行**:每项先红后绿;① 带旧格式兼容测试。

## Acceptance Criteria

- [ ] **①**:`TopicStatus = active|paused|completed|cancelled`;`Topic.outcome?: "success"|"degraded"|"failed"`。transition 表更新并拒绝非法跃迁(`active/paused → cancelled`;`cancelled → active` 仅供显式续谈重开)。收尾成功:有参与者 `failures>0` → `outcome=degraded`,否则 `success`;finalize 失败兜底 → `outcome=failed`。`cmdStop` 无 runner 的人工终止 → `status=cancelled` 且清旧 outcome;`runTopic` 不得直接重启 cancelled。`continue` 重开 completed/cancelled 时先清上一代 outcome。render/list 仅为 completed 展示 outcome。旧 `completed` 无 outcome 一律保持 unknown。测试覆盖各结束路径、重开/暂停、cancelled engine guard 与 HEAD-era 崩溃记录。
- [ ] **②**:`--repo` 时若有 inherited provider,**默认拒绝创建**并列出是哪些 provider + 指引;带 `--allow-unsafe-repo` 时照常创建并告警。enforced provider 可直接创建,但所有 `--repo` 路径都须披露“只读不等于项目指令/plugin/hook 隔离”。测试通过注入 adapter resolver 全链路验证:拒绝不建话题、覆盖建成并告警、全 enforced 建成且保留通用风险披露。
- [ ] **③**:POSIX 首次终止前捕获整树 pid+启动身份,SIGTERM 宽限后重新确认同一批进程并吸收其新后代,再 SIGKILL;不得从已退出根 PID 重新遍历,不得留下会误杀复用 PID 的延迟 timer。timeout 与流 error/overflow 共用终止 Promise,整树退出或有界强杀确认后才 settle。Windows 继续用 taskkill /T /F。测试覆盖:根忽略 TERM、根退出但 detached 孙忽略 TERM、优雅退出、overflow reject 前心跳停止。
- [ ] 全量 build + typecheck + 既有测试(126)+ 新增全绿,无回归。

## Notes

- ① 的 outcome 语义边界(design 定死):degraded=讨论完成但有参与者失败;failed=finalize 环节自身失败;cancelled 是独立 status(人工无收尾终止),不带 outcome。
- ② realize 了 `adapters/types.ts` 里"硬截止线:--repo 转正/v2 前须对 inherited 默认拒绝"的注释,落地后更新该注释。
- 收尾更新 spec:engine 不变量补 status/outcome 契约;cli-subprocess-integration 契约 5 补 TERM→KILL 与 Windows 限制。
- 关联 ADR:0031(status+outcome)、0030(supervisor/不上 DB)。
