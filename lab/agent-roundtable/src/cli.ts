#!/usr/bin/env node
import { runDoctor } from "./doctor.js";
import { cmdAttach, cmdAudit, cmdContinue, cmdList, cmdNew, cmdRunDetached, cmdShow, cmdStop, cmdVerify, parseArgs } from "./commands.js";

const USAGE = `roundtable - 多AI终端话题讨论

用法:
  roundtable new "<话题>" --providers <a,b,...>   开题并前台运行讨论
      [--perspectives ...] [--mode roundtable] [--max-rounds 3] [--model ...]
      providers 支持 claude/codex/opencode/reasonix 或 mock:<脚本路径>
  roundtable list [--json]                        列出全部话题(状态 + 轮次进度)
  roundtable continue <topic>                     从暂停点恢复并前台续跑
  roundtable stop <topic>                         结束话题(runner 在跑则请求其收尾)
  roundtable show <topic> [--follow] [--json]     渲染 transcript(--follow 流式跟随)
  roundtable attach <topic> [--as <名字>]          进入 TUI:跟随讨论 + 插话(:stop 结束,q 退出视图)
  roundtable doctor [--json] [--readonly]          检测四家 CLI 可用性与版本(--readonly 实测 claude 只读 flag,花少量 token)
`;

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === undefined || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(USAGE);
    return cmd === undefined ? 1 : 0;
  }
  if (cmd === "doctor") return runDoctor(rest.includes("--json"), rest.includes("--readonly"));

  const { positional, flags } = parseArgs(rest);
  switch (cmd) {
    case "new":
      return cmdNew(positional, flags);
    case "list":
      return cmdList(positional, flags);
    case "continue":
      return cmdContinue(positional, flags);
    case "stop":
      return cmdStop(positional, flags);
    case "show":
      return cmdShow(positional, flags);
    case "verify":
      return cmdVerify(positional, flags);
    case "audit":
      return cmdAudit(positional, flags);
    case "run-detached":
      return cmdRunDetached(positional, flags);
    case "attach":
      return cmdAttach(positional, flags);
    default:
      console.error(`未知命令: ${cmd}\n`);
      process.stdout.write(USAGE);
      return 1;
  }
}

process.exitCode = await main();
