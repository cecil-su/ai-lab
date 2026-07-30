import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendInbox,
  consumedUpTo,
  markConsumed,
  readInbox,
  readInboxRaw,
  readPending,
  INBOX_FILE,
} from "../src/store/inbox.js";
import { makeTmpDir, removeDir } from "./helpers.js";

describe("inbox store", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  it("appendInbox assigns incrementing ids", () => {
    const a = appendInbox(dir, { kind: "say", from: "cecil", body: "补充一个约束" });
    const b = appendInbox(dir, { kind: "stop", from: "cecil" });
    expect([a.id, b.id]).toEqual([1, 2]);
    const entries = readInbox(dir);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: "say", body: "补充一个约束" });
    expect(entries[1]!.body).toBeUndefined();
  });

  it("readPending respects consumption cursor", () => {
    appendInbox(dir, { kind: "say", from: "cecil", body: "one" });
    appendInbox(dir, { kind: "say", from: "cecil", body: "two" });
    expect(readPending(dir).map((e) => e.id)).toEqual([1, 2]);

    markConsumed(dir, 1);
    expect(consumedUpTo(dir)).toBe(1);
    expect(readPending(dir).map((e) => e.id)).toEqual([2]);

    markConsumed(dir, 2);
    expect(readPending(dir)).toEqual([]);
  });

  it("readInbox ignores a half-written trailing line from a concurrent writer", () => {
    appendInbox(dir, { kind: "say", from: "cecil", body: "完整的一条" });
    fs.appendFileSync(path.join(dir, INBOX_FILE), '{"id":2,"ts":"t","kind":"say","fr');
    expect(readInbox(dir).map((e) => e.id)).toEqual([1]);
    expect(readPending(dir).map((e) => e.id)).toEqual([1]);
  });

  it("cursor never moves backwards", () => {
    appendInbox(dir, { kind: "say", from: "cecil", body: "one" });
    appendInbox(dir, { kind: "say", from: "cecil", body: "two" });
    markConsumed(dir, 2);
    markConsumed(dir, 1);
    expect(consumedUpTo(dir)).toBe(2);
  });

  it("A2:中间坏行(字节交错)被跳过并计入 totalLines/badLines", () => {
    appendInbox(dir, { kind: "say", from: "a", body: "one" });
    // 模拟并发交错产生的中间坏行
    fs.appendFileSync(path.join(dir, INBOX_FILE), "{损坏的半行}\n");
    appendInbox(dir, { kind: "say", from: "a", body: "three" });
    const raw = readInboxRaw(dir);
    expect(raw.entries.map((e) => e.body)).toEqual(["one", "three"]);
    expect(raw.entries.map((e) => e.line)).toEqual([1, 3]); // 坏行占了第 2 行
    expect(raw.badLines).toEqual([2]);
    expect(raw.totalLines).toBe(3);
    // readInbox 只返回好条目
    expect(readInbox(dir)).toHaveLength(2);
  });

  it("A2:markConsumed 按物理行推进(坏行也越过),readPending 清空", () => {
    appendInbox(dir, { kind: "say", from: "a", body: "one" });
    fs.appendFileSync(path.join(dir, INBOX_FILE), "{坏}\n");
    appendInbox(dir, { kind: "say", from: "a", body: "three" });
    markConsumed(dir, readInboxRaw(dir).totalLines); // 消费到第 3 行
    expect(readPending(dir)).toEqual([]);
    expect(consumedUpTo(dir)).toBe(3);
  });

  it("A2:兼容旧 { consumed:<id> } 游标(迁移为行数)", () => {
    appendInbox(dir, { kind: "say", from: "a", body: "one" });
    appendInbox(dir, { kind: "say", from: "a", body: "two" });
    // 手写旧格式游标
    fs.writeFileSync(path.join(dir, "inbox.cursor"), JSON.stringify({ consumed: 1 }));
    expect(consumedUpTo(dir)).toBe(1); // id<=1 的条目数 = 1 行
    expect(readPending(dir).map((e) => e.body)).toEqual(["two"]);
  });
});
