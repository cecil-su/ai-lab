import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureSessionRef } from "../src/adapters/reasonix.js";
import { makeTmpDir, removeDir } from "./helpers.js";

function touch(dir: string, name: string): void {
  fs.writeFileSync(path.join(dir, name), "{}");
}

describe("reasonix captureSessionRef 唯一归属 (#4)", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  it("恰好 1 个新文件 → verified,返回该绝对路径(可信增量)", () => {
    const before = new Set(fs.readdirSync(dir));
    touch(dir, "20260730-a.jsonl");
    const ref = captureSessionRef(dir, before);
    expect(ref.trust).toBe("verified");
    expect(ref.resumable).toBe(true);
    expect(ref.value).toBe(path.join(dir, "20260730-a.jsonl"));
  });

  it("0 个新文件 → degraded(不可续)", () => {
    const before = new Set(fs.readdirSync(dir));
    const ref = captureSessionRef(dir, before);
    expect(ref.trust).toBe("degraded");
    expect(ref.resumable).toBe(false);
  });

  it("多个新文件(并发同 cwd)→ degraded,不误选他进程文件", () => {
    const before = new Set(fs.readdirSync(dir));
    touch(dir, "20260730-a.jsonl");
    touch(dir, "20260730-b.jsonl"); // 他进程并发新建
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ref = captureSessionRef(dir, before);
    expect(ref.trust).toBe("degraded");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
