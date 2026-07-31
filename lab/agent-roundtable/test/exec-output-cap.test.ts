import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execProvider, ProviderExecError } from "../src/adapters/exec.js";
import { makeTmpDir, removeDir } from "./helpers.js";

const FLOODER = fileURLToPath(new URL("./fixtures/output-flooder.mjs", import.meta.url));

describe("execProvider 输出字节上限 (①)", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  it("stdout 超上限 → reject 前杀完忽略 TERM 的进程,且与 timeout 区分", async () => {
    const heartbeat = path.join(dir, "overflow-hb.txt");
    let err: unknown;
    try {
      await execProvider({
        provider: "fake",
        cmd: process.execPath,
        args: [FLOODER, heartbeat],
        cwd: dir,
        timeoutMs: 30_000, // 远大于溢出触发,确保是被上限打断而非超时
        maxOutputBytes: 64 * 1024,
        killGraceMs: 150,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProviderExecError);
    const pe = err as ProviderExecError;
    expect(pe.detail.overflow).toBe(true);
    expect(pe.detail.timedOut).toBeFalsy(); // 不是超时

    const mark = fs.existsSync(heartbeat) ? fs.readFileSync(heartbeat, "utf8") : "";
    expect(mark).not.toBe(""); // 确认失控进程确实启动并运行过
    await new Promise((r) => setTimeout(r, 300));
    const after = fs.existsSync(heartbeat) ? fs.readFileSync(heartbeat, "utf8") : "";
    expect(after).toBe(mark); // fail() 必须等整树清理后才 reject
  }, 15_000);
});
