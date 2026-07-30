import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureSessionRef, REASONIX_LAST_SESSION } from "../src/adapters/reasonix.js";
import { makeTmpDir, removeDir } from "./helpers.js";

function touch(dir: string, name: string): void {
  fs.writeFileSync(path.join(dir, name), "{}");
}

describe("reasonix captureSessionRef 唯一归属 (#4)", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  it("恰好 1 个新文件 → 返回该绝对路径(可信增量)", () => {
    const before = new Set(fs.readdirSync(dir));
    touch(dir, "20260730-a.jsonl");
    const ref = captureSessionRef(dir, before);
    expect(ref).toBe(path.join(dir, "20260730-a.jsonl"));
  });

  it("0 个新文件 → 降级 @last", () => {
    const before = new Set(fs.readdirSync(dir));
    expect(captureSessionRef(dir, before)).toBe(REASONIX_LAST_SESSION);
  });

  it("多个新文件(并发同 cwd)→ 降级 @last,不误选他进程文件", () => {
    const before = new Set(fs.readdirSync(dir));
    touch(dir, "20260730-a.jsonl");
    touch(dir, "20260730-b.jsonl"); // 他进程并发新建
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(captureSessionRef(dir, before)).toBe(REASONIX_LAST_SESSION);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
