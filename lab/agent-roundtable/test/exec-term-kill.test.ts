import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execProvider } from "../src/adapters/exec.js";
import { makeTmpDir, removeDir } from "./helpers.js";

const IGNORER = fileURLToPath(new URL("./fixtures/sigterm-ignorer.mjs", import.meta.url));
const PARENT_EXITS_CHILD_IGNORES = fileURLToPath(
  new URL("./fixtures/sigterm-parent-exits-child-ignores.mjs", import.meta.url),
);
const GRACEFUL = fileURLToPath(new URL("./fixtures/sigterm-graceful.mjs", import.meta.url));

describe("execProvider TERM→KILL 升级 (③)", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  it("忽略 SIGTERM 的 provider → 宽限后 SIGKILL 强杀整树(跨平台:心跳停止)", async () => {
    const heartbeat = path.join(dir, "hb.txt");
    await expect(
      execProvider({
        provider: "fake",
        cmd: process.execPath,
        args: [IGNORER, heartbeat],
        cwd: dir,
        timeoutMs: 300,
        killGraceMs: 300, // 短宽限,快速升级到 SIGKILL
      }),
    ).rejects.toThrow(/超时/);

    // reject 发生在有界整树清理之后(POSIX:SIGTERM 无视→宽限→SIGKILL;Windows:taskkill /F 即杀)
    const mark = fs.existsSync(heartbeat) ? fs.readFileSync(heartbeat, "utf8") : "";
    expect(mark).not.toBe(""); // 夹具必须确实启动过,避免 empty===empty 假阳性
    await new Promise((r) => setTimeout(r, 400));
    const after = fs.existsSync(heartbeat) ? fs.readFileSync(heartbeat, "utf8") : "";
    expect(after).toBe(mark); // 整树已死,孙进程心跳停止
  }, 10_000);

  it("根响应 TERM 退出、detached 孙进程忽略 TERM → reject 前仍强杀孙进程", async () => {
    const heartbeat = path.join(dir, "reparent-hb.txt");
    await expect(
      execProvider({
        provider: "fake",
        cmd: process.execPath,
        args: [PARENT_EXITS_CHILD_IGNORES, heartbeat],
        cwd: dir,
        timeoutMs: 300,
        killGraceMs: 300,
      }),
    ).rejects.toThrow(/超时/);

    const mark = fs.existsSync(heartbeat) ? fs.readFileSync(heartbeat, "utf8") : "";
    expect(mark).not.toBe(""); // detached 孙进程确实建立后才有证明力
    await new Promise((r) => setTimeout(r, 400));
    const after = fs.existsSync(heartbeat) ? fs.readFileSync(heartbeat, "utf8") : "";
    expect(after).toBe(mark);
  }, 10_000);

  // POSIX 专属:SIGTERM 语义仅在 POSIX 生效(Windows tree-kill 恒 taskkill /F,无优雅期)
  it.skipIf(process.platform === "win32")(
    "响应 SIGTERM 的 provider → 即退,不等满宽限",
    async () => {
      const started = Date.now();
      await expect(
        execProvider({
          provider: "fake",
          cmd: process.execPath,
          args: [GRACEFUL],
          cwd: dir,
          timeoutMs: 200,
          killGraceMs: 5000, // 长宽限;若被无视要等 5s 才 SIGKILL
        }),
      ).rejects.toThrow(/超时/);
      // provider 收 SIGTERM 即 exit(0) → 'close' 快速触发,远早于 5s 宽限
      expect(Date.now() - started).toBeLessThan(2000);
    },
    10_000,
  );
});
