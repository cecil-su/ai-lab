// 测试夹具:模拟失控 provider —— 持续向 stdout 狂吐、忽略 SIGTERM。
// argv[2] 可传心跳文件,用于验证 overflow reject 前已完成 TERM→KILL 清理。
import fs from "node:fs";

process.on("SIGTERM", () => {});
const heartbeat = process.argv[2];
if (heartbeat) {
  try { fs.writeFileSync(heartbeat, String(Date.now())); } catch {}
  setInterval(() => {
    try { fs.writeFileSync(heartbeat, String(Date.now())); } catch {}
  }, 30);
}
const chunk = "x".repeat(8192);
setInterval(() => {
  process.stdout.write(chunk);
}, 1);
