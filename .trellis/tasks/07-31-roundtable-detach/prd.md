# agent-roundtable: detach 后台运行 (Phase-3 ⑤)

## Goal

`roundtable new --detach`：后台运行 runner 不占终端，`attach` 观察/插话，`list` 查状态，`stop`/`continue` 管理。发布门槛（4 模型裁决）：恢复不重复调用 / 预算边界可解释 / 降级不伪装成功——三项底层能力已就位（finalization 代际幂等、calls 预留制、status/outcome 正交），本任务只加进程管理形态。

## Requirements

1. `cmdNew --detach`：创建话题后 spawn 后台子进程执行 `run-detached <id>`（内部命令），父进程立即返回 0。
2. `run-detached <id>`：前台逻辑等价 runTopic；stdout/stderr 落盘话题目录 `run.log`；退出码语义化（0=终态 completed、2=paused 可续、1=异常）。
3. 子进程生命周期：spawn detached+unref（父退出不影响）、windowsHide；runner.lock 由子进程持有（既有跨进程锁天然互斥，二次 new/continue 会拒绝）。
4. 观察面：`attach`（既有 TUI）、`list`（既有）、`stop`（既有 inbox stop / 取消）、`continue`（既有恢复）。
5. 门槛验证测试：后台子进程崩溃后 continue 不重复调用（代际幂等复用）；预算用尽落 paused 可续；completed·failed 不伪装 success。

## Acceptance Criteria

- [ ] `new --detach` 返回后子进程在跑（runner.lock 活锁），attach/list 可用。
- [ ] 子进程完成后：run.log 存在、锁释放、状态/outcome 正确落盘、退出码语义化。
- [ ] 门槛三条有测试锚定（崩溃恢复不重复调用、预算暂停可续、failed 不伪装）。
- [ ] 全量测试通过，无回归。

## Notes

- 实现形态：spawn(process.execPath, [cli, "run-detached", id], { detached, stdio: [ignore, logFd, logFd], windowsHide })。
- 日志文件 `run.log` 追加式；不影响 transcript/topic 存储（那些已有独立机制）。
