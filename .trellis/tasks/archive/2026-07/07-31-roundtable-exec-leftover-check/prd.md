# agent-roundtable: exec 正常退出遗留 daemon 检查 (Phase-3 ③)

## Goal

评审 F4：provider 进程以 code 0 正常退出、但留下 detached 后台进程时，当前 execProvider 直接判定成功，遗留进程可继续耗 token/写仓库。用已实现的身份快照机制在正常退出路径补一次遗留校验。

## Requirements

1. `execProvider` 在 `close`（code 0 或非 0）时，复用 `killTree` 的身份追踪能力做**有界**遗留检查：仍存活的同树进程（pid+启动身份匹配）→ 判定为遗留。
2. 行为：检测到遗留 → 尝试有界清理（SIGTERM→KILL，与失败路径同一 killTree）；清理后仍存活 → 视为 degraded 结果：成功返回但附带告警，或拒绝——**决策：返回成功 + stderr 附加告警**（正常输出不应因后台进程被丢，但必须显式披露），避免静默。
3. 开销控制：正常路径每次调用多一次进程表查询（~50ms，可接受）；查询失败静默降级（不做遗留检查，不阻塞正常返回）。
4. 测试：fixture = 主进程 exit(0) 但拉起 detached 孙进程写心跳 → 断言返回成功且孙进程被清理（或告警存在）；正常无遗留 → 无额外行为。

## Acceptance Criteria

- [ ] 正常退出 + 遗留 daemon：返回成功、stderr 含明确告警、遗留进程被有界清理。
- [ ] 正常退出无遗留：行为与现状一致（无告警）。
- [ ] 全量测试通过，无回归。

## Notes

- 轻量任务，PRD-only 即可；实现依赖 Phase-2 ③ 的 `refreshOwned`/`killTree`。
