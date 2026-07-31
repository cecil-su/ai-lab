import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractRefs, transcriptFingerprint, verifyEvidence } from "../src/engine/evidence.js";
import { appendEvent, TRANSCRIPT_FILE } from "../src/store/transcript.js";
import { makeTmpDir, removeDir } from "./helpers.js";

describe("evidence 引用验证器 (真机模型验收标准)", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  function writeSummary(text: string): void {
    fs.writeFileSync(path.join(dir, "summary.md"), text);
  }

  it("extractRefs 解析 [seq N] 引用", () => {
    expect(extractRefs("## 证据索引\n- [seq 2] R1 a: x\n- [seq 7] R2 b: y\n无引用段")).toEqual([2, 7]);
    expect(extractRefs("无引用")).toEqual([]);
  });

  it("全部引用可解析 + 指纹稳定", () => {
    appendEvent(dir, { kind: "system", round: 0, body: "开题" });
    appendEvent(dir, { kind: "message", round: 1, from: "a", body: "发言A" });
    writeSummary("## 证据索引\n- [seq 2] R1 a: 发言A");
    const r1 = verifyEvidence(dir);
    expect(r1.ok).toBe(true);
    expect(r1.refs).toEqual([{ seq: 2, line: "message R1 a", status: "ok" }]);
    expect(r1.badLines).toEqual([]);
    // 指纹稳定:再次验证 hash 一致
    expect(transcriptFingerprint(dir)).toBe(r1.transcriptHash);
    // expectHash 匹配
    expect(verifyEvidence(dir, { expectHash: r1.transcriptHash }).hashMatch).toBe(true);
    // expectHash 不匹配 → 整体不 ok
    expect(verifyEvidence(dir, { expectHash: "deadbeef" }).ok).toBe(false);
  });

  it("悬空引用(seq 不存在)→ dangling 且不 ok", () => {
    appendEvent(dir, { kind: "message", round: 1, from: "a", body: "x" });
    writeSummary("- [seq 99] R1 a: 不存在的引用");
    const r = verifyEvidence(dir);
    expect(r.refs[0]).toMatchObject({ seq: 99, status: "dangling" });
    expect(r.ok).toBe(false);
  });

  it("误引(system 事件被引用)→ wrong-kind", () => {
    appendEvent(dir, { kind: "system", round: 0, body: "开题" }); // seq 1
    writeSummary("- [seq 1] R0 system");
    const r = verifyEvidence(dir);
    expect(r.refs[0]).toMatchObject({ seq: 1, status: "wrong-kind" });
    expect(r.ok).toBe(false);
  });

  it("坏行存在 → 整体降级(不 ok),即使引用都可解析", () => {
    appendEvent(dir, { kind: "message", round: 1, from: "a", body: "x" }); // seq 1
    fs.appendFileSync(path.join(dir, TRANSCRIPT_FILE), "{坏行}\n");
    writeSummary("- [seq 1] R1 a");
    const r = verifyEvidence(dir);
    expect(r.refs[0]!.status).toBe("ok");
    expect(r.badLines).toHaveLength(1);
    expect(r.ok).toBe(false); // 坏行 → 引用可能不完整,不 ok
  });
});
