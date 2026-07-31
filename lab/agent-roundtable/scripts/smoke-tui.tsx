// 手动 smoke:mock runner 后台跑一个话题,attach TUI 上去观察。
// 用 ROUNDTABLE_HOME 隔离到临时目录,不碰真实 CLI、不消耗 token。
//
// 运行:pnpm -F agent-roundtable smoke:tui
// 在真实 Windows Terminal / VS Code 终端里运行时可看到:
//   - 发言按参与者着色实时出现、状态栏轮次/runner/token 更新
//   - 中途自动注入一条 human 插话(模拟输入框回车),先 pending 后转正显示
//   - attach 视图在 runner 仍在跑时退出(模拟 q),runner 不受影响继续
//   - 之后写入 :stop 控制事件,runner 在安全边界收尾 completed
//
// 非 TTY 环境(如 CI/管道)下键盘输入不可用,脚本改用 appendInbox 程序化模拟“输入框提交”,
// 并在结尾打印 transcript 断言,证明 say/stop/退出独立性均生效。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { render } from "ink";
import { makeVerified, type ProviderAdapter } from "../src/adapters/types.js";
import { buildCharter } from "../src/engine/charter.js";
import { runTopic } from "../src/engine/runner.js";
import { appendInbox } from "../src/store/inbox.js";
import { createTopic } from "../src/store/topic.js";
import { readTranscript } from "../src/store/transcript.js";
import { App } from "../src/tui/App.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// 每次发言慢 700ms,让讨论跨数秒,便于 attach 观察与中途插话
function slowMock(): ProviderAdapter {
  return {
    name: "mock",
    async detect() {
      return { ok: true, version: "mock" };
    },
    async speak({ prompt, sessionRef }) {
      await sleep(700);
      const turn = sessionRef ? Number(sessionRef.value) : 0;
      const text = `第 ${turn + 1} 版观点,持续推进论证。【立场】立场版本-${turn + 1}`;
      return {
        text,
        sessionRef: makeVerified("mock", String(turn + 1)),
        tokens: { input: Math.ceil(prompt.length / 4), output: 20 },
      };
    },
  };
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-smoke-tui-"));
  process.env.ROUNDTABLE_HOME = root;
  const id = "2026-07-30-smoke-tui";
  const dir = path.join(root, id);
  const title = "缓存选型:Redis vs 内存";

  createTopic(root, {
    id,
    title,
    mode: "roundtable",
    maxRounds: 5,
    participants: [
      { handle: "mock-architect", provider: "mock:slow", perspective: "architect" },
      { handle: "mock-cost", provider: "mock:slow", perspective: "cost" },
    ],
  });
  fs.writeFileSync(
    path.join(dir, "charter.md"),
    buildCharter({
      title,
      mode: "roundtable",
      maxRounds: 5,
      participants: [
        { handle: "mock-architect", providerBase: "mock", perspective: "architect" },
        { handle: "mock-cost", providerBase: "mock", perspective: "cost" },
      ],
    }),
  );

  console.log(`[smoke] topic dir: ${dir}`);

  // 1) 后台起 runner(不装 SIGINT handler,避免与 Ink 抢 Ctrl+C)
  const runnerPromise = runTopic(dir, {
    resolveAdapter: () => slowMock(),
    installSignalHandlers: false,
  });

  // 2) attach TUI 前台渲染
  const app = render(<App dir={dir} humanName="cecil" canWrite={true} />);

  // 3) 程序化模拟“输入框提交插话”与“q 退出”,与渲染并行推进
  await sleep(1800);
  console.log("\n[smoke] 模拟输入框提交 say(插话)");
  appendInbox(dir, { kind: "say", from: "cecil", body: "补充约束:峰值 QPS 5万,预算有限" });

  await sleep(3000);
  console.log("[smoke] 模拟 q 退出 attach 视图(runner 应继续)");
  app.unmount();
  await app.waitUntilExit();

  // 4) attach 已退出:runner 应仍在跑
  const stillRunning = await Promise.race([
    runnerPromise.then(() => false),
    sleep(50).then(() => true),
  ]);
  console.log(`\n[smoke] attach 退出后 runner 仍在运行: ${stillRunning}`);

  // 5) 写 :stop 控制事件(模拟 TUI 内 :stop),runner 安全边界收尾
  console.log("[smoke] 写入 :stop 控制事件");
  appendInbox(dir, { kind: "stop", from: "cecil" });

  const finalTopic = await runnerPromise;
  const events = readTranscript(dir);
  const humanEvents = events.filter((e) => e.kind === "human");
  const rounds = Math.max(0, ...events.filter((e) => e.kind === "round_end").map((e) => e.round));

  console.log("\n===== smoke 断言 =====");
  console.log(`最终状态: ${finalTopic.status} (期望 completed)`);
  console.log(`human 插话事件数: ${humanEvents.length} (期望 >= 1)`);
  console.log(`已完成轮次: ${rounds} (因 :stop 提前收尾,应 < maxRounds=5)`);
  console.log(`transcript 事件数: ${events.length}`);
  for (const e of events) {
    const tag = e.kind === "human" ? "  <<< 插话" : "";
    console.log(`  #${e.seq} ${e.kind} R${e.round} ${e.from ?? ""} ${e.body ?? ""}${tag}`);
  }

  const ok = finalTopic.status === "completed" && humanEvents.length >= 1 && stillRunning === true;
  console.log(`\n[smoke] 结果: ${ok ? "PASS" : "FAIL"}`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}

await main();
