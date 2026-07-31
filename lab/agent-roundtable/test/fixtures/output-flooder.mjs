// 测试夹具:模拟失控 provider —— 持续向 stdout 狂吐,永不退出。
// 用于验证 execProvider 对输出累积设了字节上限,超限即杀进程 + 溢出错误。
const chunk = "x".repeat(8192);
setInterval(() => {
  process.stdout.write(chunk);
}, 1);
