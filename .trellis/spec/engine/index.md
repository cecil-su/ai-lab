# Engine 层代码规范

> `lab/agent-roundtable` 引擎(runner / finalize / 锁 / 会话信任)的执行契约。

## Available Specs

| Spec | Purpose | When to Use |
|------|---------|-------------|
| [Roundtable 引擎不变量](./roundtable-engine-invariants.md) | 并发/超时/崩溃/人工中断边界下必须守住的契约:completed⇒summary、isTrustedRef 闸门、finalize 幂等、锁原子占坑 | 改动 runner / modes(finalize)/ lock / attach / session 信任 / cmdStop 时 |

## 相关

- 子进程集成(进程树 kill、reasonix 会话唯一归属)见 [guides/cli-subprocess-integration.md](../guides/cli-subprocess-integration.md)。
