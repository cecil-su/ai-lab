// 测试夹具:收到 SIGTERM 立即优雅退出。
// 验证 killTree 的"先礼"——provider 响应 SIGTERM 即退,不必等满 SIGKILL 宽限。
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
