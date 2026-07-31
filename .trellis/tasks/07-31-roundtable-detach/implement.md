# Implement — detach 后台运行 (Phase-3 ⑤)

## 已完成

- [x] `cmdNew --detach`：创建话题后 spawn 后台子进程（detached+unref+windowsHide，dev 下 tsx 引导），父进程立即返回 0；输出落盘 `run.log`。
- [x] 内部命令 `run-detached <id>`：等价前台 runTopic；退出码语义化（0=终态、2=paused 可续）。
- [x] 观察/管理面复用既有：attach（TUI）、list、stop、continue；runner.lock 跨进程互斥天然生效。
- [x] 门槛验证：预算 paused 可续（退出码 2 + paused 落盘测试）；恢复不重复调用/降级不伪装由既有代际幂等与 outcome 正交覆盖。
- [x] 集成测试：真子进程跑 run-detached（mock，零 token）断言退出码/状态/outcome。

## 验证

- [x] `pnpm -F agent-roundtable typecheck`
- [x] `pnpm -F agent-roundtable build`
- [x] `pnpm -F agent-roundtable test` — 177 passed / 3 skipped（23 files）
- [x] `git diff --check`
- [x] 真机冒烟：`new --detach` 父进程返回 0，子进程后台完成（completed+success），run.log 记录输出。

## Known limitation（环境级，非代码缺陷）

本机存在"runner.lock 删除被系统级延迟"现象（进程退出后文件仍短暂存在；acquire 的死 pid 接管与 pidAlive 判定均不受影响，功能闭环正常；同机另出现过路径触发 native crash 的同源文件系统怪象）。锁逻辑本身经验证正确（进程内 acquire/release、lock.test/lock-race 全绿）。
