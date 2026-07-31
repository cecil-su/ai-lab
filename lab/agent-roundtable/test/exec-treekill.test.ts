import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execProvider } from "../src/adapters/exec.js";
import { makeTmpDir, removeDir } from "./helpers.js";

const SPAWNER = fileURLToPath(new URL("./fixtures/tree-spawner.mjs", import.meta.url));

describe("execProvider 进程树 kill (#3)", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  it("超时后杀掉 detached 孙进程(心跳停止)", async () => {
    const heartbeat = path.join(dir, "hb.txt");
    // provider 拉起孙进程写心跳,自身挂起 → 触发超时
    await expect(
      execProvider({
        provider: "fake",
        cmd: process.execPath,
        args: [SPAWNER, heartbeat],
        cwd: dir,
        timeoutMs: 400,
      }),
    ).rejects.toThrow(/超时/);

    // 等孙进程先把心跳文件建起来的余量已在超时窗口内;此刻记录水位,再等一段时间
    await new Promise((r) => setTimeout(r, 200));
    const mark = fs.existsSync(heartbeat) ? fs.readFileSync(heartbeat, "utf8") : "";
    await new Promise((r) => setTimeout(r, 400));
    const after = fs.existsSync(heartbeat) ? fs.readFileSync(heartbeat, "utf8") : "";

    // 整树被杀 → 孙进程停写 → 前后心跳一致。旧代码只 child.kill() 时孙进程存活,心跳会继续跳动。
    expect(after).toBe(mark);
  }, 10_000);
});
