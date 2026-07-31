// 测试夹具:一个独立进程,自旋等到统一起跑时刻后抢一次 runner 锁,打印结果。
// 用真实子进程(各自不同 pid)制造跨进程竞争 —— worker_threads 共享 pid 无法复现。
// argv[2] = 话题目录;argv[3] = 起跑时刻(epoch ms)。
import { acquireLock } from "../../src/store/lock.js";

const dir = process.argv[2]!;
const startAt = Number(process.argv[3]);

while (Date.now() < startAt) {
  // busy-wait 到统一起跑点,让所有 racer 尽量同刻进入 acquireLock
}

const res = acquireLock(dir);
process.stdout.write(res.ok ? "OK\n" : `NO:${res.holder.pid}\n`);

// 赢家须持锁到竞争窗口结束(真实 runner 持锁至进程结束);否则本进程立刻退出、
// pid 变死,后到 racer 会按"死锁接管"合法再赢,污染"至多一持有"的断言。
if (res.ok) {
  const holdUntil = startAt + 2500;
  while (Date.now() < holdUntil) {
    // 空转持锁
  }
}
