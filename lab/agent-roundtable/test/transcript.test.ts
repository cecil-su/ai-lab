import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
