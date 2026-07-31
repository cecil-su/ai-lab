// 主进程运行 400ms 后 exit(0),但先拉起 detached 孙进程持续写心跳。
// 模拟 provider 正常退出却遗留后台任务;验证 execProvider 退出后遗留检查(F4)。
import { spawn } from "node:child_process";

const heartbeat = process.argv[2];
const child = spawn(
  process.execPath,
  ["-e", `const fs=require('fs');try{fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now()))}catch{};setInterval(()=>{try{fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now()))}catch{}},30)`],
  { detached: true, stdio: "ignore" },
);
child.unref();

const main = setInterval(() => {}, 1000);
setTimeout(() => {
  clearInterval(main);
  process.exit(0);
}, 400);
