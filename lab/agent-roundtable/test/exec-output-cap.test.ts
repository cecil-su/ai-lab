import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execProvider, ProviderExecError } from "../src/adapters/exec.js";
import { makeTmpDir, removeDir } from "./helpers.js";

const FLOODER = fileURLToPath(new URL("./fixtures/output-flooder.mjs", import.meta.url));

describe("execProvider 输出字节上限 (①)", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  it("stdout 超上限 → 杀进程 + 溢出错误(与 timeout 区分)", async () => {
    let err: unknown;
    try {
      await execProvider({
        provider: "fake",
        cmd: process.execPath,
        args: [FLOODER],
        cwd: dir,
        timeoutMs: 30_000, // 远大于溢出触发,确保是被上限打断而非超时
        maxOutputBytes: 64 * 1024,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProviderExecError);
    const pe = err as ProviderExecError;
    expect(pe.detail.overflow).toBe(true);
    expect(pe.detail.timedOut).toBeFalsy(); // 不是超时
  }, 15_000);
});
