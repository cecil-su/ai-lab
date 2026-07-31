import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendEvent,
  readTranscript,
  watchTranscript,
  TRANSCRIPT_FILE,
  type TranscriptEvent,
} from "../src/store/transcript.js";
import { makeTmpDir, removeDir, until } from "./helpers.js";

describe("transcript store", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  it("appendEvent assigns strictly increasing seq from 1", () => {
    const a = appendEvent(dir, { kind: "system", round: 0, body: "开题" });
    const b = appendEvent(dir, { kind: "message", round: 1, from: "claude-architect", body: "观点" });
    const c = appendEvent(dir, { kind: "round_end", round: 1 });
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    const events = readTranscript(dir);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events[1]).toMatchObject({ kind: "message", from: "claude-architect", round: 1 });
    expect(events[0]!.ts).toBeTruthy();
  });

  it("readTranscript returns [] when file missing", () => {
    expect(readTranscript(dir)).toEqual([]);
  });

  it("崩溃残留半行:appendEvent 换行护栏隔离,不合并成中间坏行", () => {
    const file = path.join(dir, TRANSCRIPT_FILE);
    fs.writeFileSync(file, '{"seq":1,"ts":"t","kind":"system","round":0}\n');
    // 模拟崩溃中途写出一行无换行的半 JSON
    fs.appendFileSync(file, '{"seq":2,"kind":"mess');

    // 下一次 append 必须从新行开始,半行被隔离为独立坏行(容错跳过)
    const e = appendEvent(dir, { kind: "message", round: 1, from: "a", body: "恢复后续写" });
    expect(e.seq).toBe(2);
    const events = readTranscript(dir);
    expect(events.map((x) => x.seq)).toEqual([1, 2]);
    expect(events[1]).toMatchObject({ kind: "message", from: "a", body: "恢复后续写" });
    // 原始半行仍在文件里(作为坏行),但没有污染新事件
    const raw = fs.readFileSync(file, "utf8");
    expect(raw.split("\n").filter((l) => l.trim() !== "")).toHaveLength(3);
  });

  it("readTranscript 容错:中间坏行跳过并告警,不抛错", () => {
    const file = path.join(dir, TRANSCRIPT_FILE);
    fs.writeFileSync(
      file,
      [
        '{"seq":1,"ts":"t","kind":"system","round":0}',
        "{半截JSON+完整JSON合并的坏行}",
        '{"seq":2,"ts":"t","kind":"message","round":1,"from":"a","body":"ok"}',
      ].join("\n") + "\n",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = readTranscript(dir);
    expect(events.map((x) => x.seq)).toEqual([1, 2]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("损坏已跳过"));
    spy.mockRestore();
  });

  it("readTranscript throws on non-increasing seq", () => {
    const file = path.join(dir, TRANSCRIPT_FILE);
    fs.writeFileSync(
      file,
      ['{"seq":1,"ts":"t","kind":"system","round":0}', '{"seq":1,"ts":"t","kind":"round_end","round":0}'].join("\n") + "\n",
    );
    expect(() => readTranscript(dir)).toThrow(/corrupted/);
  });

  it("watchTranscript tails only new events and stops on unsubscribe", async () => {
    appendEvent(dir, { kind: "system", round: 0, body: "watch 之前的事件" });
    const received: TranscriptEvent[] = [];
    const stop = watchTranscript(dir, (events) => received.push(...events), { pollMs: 25 });

    appendEvent(dir, { kind: "message", round: 1, from: "a", body: "第一" });
    appendEvent(dir, { kind: "message", round: 1, from: "b", body: "第二" });
    await until(() => received.length >= 2);
    expect(received.map((e) => e.seq)).toEqual([2, 3]);

    stop();
    appendEvent(dir, { kind: "round_end", round: 1 });
    await new Promise((r) => setTimeout(r, 80));
    expect(received).toHaveLength(2);
  });
});
