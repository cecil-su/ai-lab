// 根进程响应 SIGTERM 退出,detached 孙进程忽略 SIGTERM 并持续写心跳。
// 用于验证 supervisor 保留首次树快照:根退出/reparent 后仍能在宽限末强杀孙进程。
import { spawn } from "node:child_process";

const heartbeat = process.argv[2];
const childCode = `
  const fs = require("fs");
  process.on("SIGTERM", () => {});
  try { fs.writeFileSync(${JSON.stringify(process.argv[2])}, String(Date.now())); } catch {}
  setInterval(() => {
    try { fs.writeFileSync(${JSON.stringify(process.argv[2])}, String(Date.now())); } catch {}
  }, 30);
`;
const child = spawn(process.execPath, ["-e", childCode], {
  detached: true,
  stdio: "ignore",
});
child.unref();

process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
