// 测试夹具:模拟 provider CLI —— 拉起一个 detached 孙进程持续写心跳,然后父进程自身挂起。
// 用于验证 execProvider 超时后是否杀掉整棵进程树(孙进程心跳应停止)。
// argv[2] = 心跳文件路径;孙进程每 30ms 写入当前时间戳。
import { spawn } from "node:child_process";

const heartbeat = process.argv[2];
const grandchild = spawn(
  process.execPath,
  ["-e", `const fs=require('fs');setInterval(()=>{try{fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now()))}catch{}},30)`],
  { detached: true, stdio: "ignore" },
);
grandchild.unref();

// 父进程挂起,不产出 stdout,促使 execProvider 超时。
setInterval(() => {}, 1000);
