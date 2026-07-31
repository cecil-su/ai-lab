# Implement — 架构加固 Phase-2

## 已完成

- [x] status/outcome 拆分
  - `cancelled` 终态、`success|degraded|failed` outcome。
  - completed/cancelled 仅可由 `cmdContinue` 显式重开；重开与取消清旧 outcome。
  - `runTopic` 对两个终态均短路。
  - HEAD-era completed/summary-written 缺 outcome 一律保持 unknown，不臆测结果。
  - render/list 仅为 completed 投影 outcome。
- [x] capabilities 接策略层
  - `--repo` + inherited 默认拒绝，`--allow-unsafe-repo` 显式覆盖。
  - 注入 adapter resolver 的 `cmdNew` 全链路测试覆盖拒绝、覆盖、全 enforced。
  - 所有 `--repo` 路径都披露项目指令/plugin/hook 不受只读权限隔离。
- [x] exec TERM→KILL
  - Windows：有 timeout 的 `taskkill /T /F`，失败且根仍活时报告 cleanup failure。
  - POSIX：捕获进程树启动身份；TERM 宽限后按身份强杀 survivors；查询失败时保留并强杀已捕获后代，再走有界 tree-kill fallback。
  - Linux 用 `/proc/<pid>/stat` starttime tick 防 PID 复用；其他 POSIX 使用 `ps lstart`。
  - timeout、stream error、output overflow 均在有界清理完成后 reject。
  - 覆盖“根退出、detached 孙忽略 TERM”与 overflow reject 前心跳停止。
- [x] README、engine invariant、subprocess integration spec 同步。

## 验证

- [x] `pnpm -F agent-roundtable typecheck`
- [x] `pnpm -F agent-roundtable build`
- [x] `pnpm -F agent-roundtable test` — 19 files，141 passed，1 POSIX-only test skipped on Windows
- [x] `git diff --check`

## Residual risk

- 纯用户态 POSIX 进程表方案无法完全消除“detached 后代在首次快照前创建并恰好随根退出”的极窄竞态；若未来进入无人值守/服务端运行，应升级为 OS containment（Windows Job Object、Linux cgroup/subreaper）。
- macOS 缺少 Linux `/proc` 高精度 starttime，PID 身份退化为 `ps lstart`；宽限窗口很短但仍弱于 Linux。

## 提交建议

按范围拆分提交：
1. lifecycle/outcome + tests
2. repo capability policy + README/tests
3. process supervision + fixtures/spec

不要混入工作区中 `.gitignore`、`CLAUDE.md`、AgentParty 等无关改动。
