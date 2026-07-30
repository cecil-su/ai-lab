import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTmpDir, removeDir } from "./helpers.js";

const RACER = fileURLToPath(new URL("./fixtures/lock-racer.ts", import.meta.url));

/** 起一个 racer 子进程(各自不同 pid),返回其单行输出(OK / NO:<pid>) */
function runRacer(dir: string, startAt: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", RACER, dir, String(startAt)], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (out += c));
    child.once("error", reject);
    child.once("close", () => resolve(out.trim()));
  });
}

describe("runner 锁跨进程原子互斥 (#1)", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  it("N 进程同刻抢锁,恰有一个成功", async () => {
    const N = 12;
    const startAt = Date.now() + 1500; // 给所有子进程留足 spawn + tsx 启动时间再统一起跑
    const results = await Promise.all(Array.from({ length: N }, () => runRacer(dir, startAt)));

    const winners = results.filter((r) => r === "OK");
    expect(winners.length).toBe(1);
    // 其余全部拿到明确拒绝(NO:<pid>),不得有空/异常输出
    expect(results.filter((r) => r.startsWith("NO:")).length).toBe(N - 1);
  }, 30_000);
});
