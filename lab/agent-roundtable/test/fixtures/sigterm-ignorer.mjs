// 测试夹具:忽略 SIGTERM 并拉起 detached 孙进程写心跳。
// 验证 killTree 的"后兵"——SIGTERM 被无视时,宽限后 SIGKILL 仍强杀整树。
// argv[2] = 心跳文件路径。
import { spawn } from "node:child_process";

process.on("SIGTERM", () => {}); // 无视优雅退出请求

const heartbeat = process.argv[2];
const gc = spawn(
  process.execPath,
  ["-e", `const fs=require('fs');try{fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now()))}catch{};setInterval(()=>{try{fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now()))}catch{}},30)`],
  { detached: true, stdio: "ignore" },
);
gc.unref();

setInterval(() => {}, 1000);
