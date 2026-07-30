import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendInbox,
  consumedUpTo,
  markConsumed,
  readInbox,
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
});
