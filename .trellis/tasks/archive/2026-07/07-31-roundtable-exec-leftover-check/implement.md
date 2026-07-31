# Implement — exec 正常退出遗留 daemon 检查 (Phase-3 ③)

## 已完成

- [x] `execProvider` 启动时后台快照进程树身份（POSIX，非 win32）。
- [x] `close` 时复用 `refreshOwned`/`signalOwned`/`waitUntilGone` 做有界遗留检查：存活成员先礼后兵清理，结果以 stderr + console 告警披露，不吞正常输出。
- [x] 根进程先于快照退出 / ps 失败 → 放弃检查，不阻塞返回。
- [x] 异常退出（code≠0）同样清理遗留 daemon。
- [x] 测试：`exit0-leaves-daemon.mjs` fixture（正常退出遗留 daemon → 成功 + 告警 + 心跳停止；无遗留 → stderr 为空）。POSIX-only，Windows 跳过。
- [x] spec（cli-subprocess-integration）补 F4 说明。

## 验证

- [x] `pnpm -F agent-roundtable typecheck`
- [x] `pnpm -F agent-roundtable test` — 142 passed / 3 skipped（含 2 个新增 POSIX-only）
- [x] `git diff --check`

## Residual risk

- 新增 2 个 POSIX-only 用例需 Linux 实跑验证（Windows 已跳过）。
- 正常路径每次调用多一次 ps 查询（~50ms 级），本地 CLI 可接受。
- 极窄竞态：provider 在快照完成前退出 → 漏检（接受，不阻塞）。
