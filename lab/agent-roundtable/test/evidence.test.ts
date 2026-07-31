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

  it("全部引用可解析 + 指纹稳定(绑定 expectHash 时通过)", () => {
    appendEvent(dir, { kind: "system", round: 0, body: "开题" });
    appendEvent(dir, { kind: "message", round: 1, from: "a", body: "发言A" });
    writeSummary("## 证据索引\n- [seq 2] R1 a: 发言A");
    // 无 topic.json/topic.json 无 summaryEvidence → 不可验证(终审④:不默认通过)
    const unbound = verifyEvidence(dir);
    expect(unbound.evidenceBound).toBe(false);
    expect(unbound.ok).toBe(false);
    // 显式 expectHash(等价引擎绑定)→ 通过
    const fp = transcriptFingerprint(dir);
    const r1 = verifyEvidence(dir, { expectHash: fp });
    expect(r1.ok).toBe(true);
    expect(r1.evidenceBound).toBe(true);
    expect(r1.refs).toEqual([{ seq: 2, line: "message R1 a", kind: "message", status: "ok" }]);
    expect(r1.badLines).toEqual([]);
    // 指纹稳定
    expect(transcriptFingerprint(dir)).toBe(r1.transcriptHash);
    expect(verifyEvidence(dir, { expectHash: r1.transcriptHash }).hashMatch).toBe(true);
    expect(verifyEvidence(dir, { expectHash: "deadbeef" }).ok).toBe(false);
  });

  it("终审③:零引用不得通过;仅 verdict/skip 引用不得通过;须至少一条 message", () => {
    appendEvent(dir, { kind: "message", round: 1, from: "a", body: "发言A" }); // seq 1
    appendEvent(dir, { kind: "skip", round: 1, from: "b" }); // seq 2
    appendEvent(dir, { kind: "verdict", round: 2, from: "judge", body: "裁" }); // seq 3
    const fp = transcriptFingerprint(dir);
    // 零引用
    writeSummary("# 无索引的 summary");
    expect(verifyEvidence(dir, { expectHash: fp }).ok).toBe(false);
    // 仅 skip 引用
    writeSummary("## 证据索引\n- [seq 2] R1 b");
    expect(verifyEvidence(dir, { expectHash: fp }).ok).toBe(false);
    // 仅 verdict 引用
    writeSummary("## 证据索引\n- [seq 3] R2 judge");
    expect(verifyEvidence(dir, { expectHash: fp }).ok).toBe(false);
    // 含 message → 通过
    writeSummary("## 证据索引\n- [seq 1] R1 a: 发言A");
    expect(verifyEvidence(dir, { expectHash: fp }).ok).toBe(true);
  });

  it("终审④:引擎 summaryEvidence 绑定 —— 篡改后默认 verify 失败", () => {
    // 构造带 summaryEvidence 的 topic.json
    fs.writeFileSync(path.join(dir, "topic.json"), JSON.stringify({ version: 2, id: "t", title: "x", mode: "roundtable", status: "completed", maxRounds: 1, currentRound: 1, createdAt: "t", participants: [], summaryEvidence: { transcriptHash: "", generation: 1 } }));
    appendEvent(dir, { kind: "message", round: 1, from: "a", body: "发言A" });
    writeSummary("## 证据索引\n- [seq 1] R1 a: 发言A");
    const fp = transcriptFingerprint(dir);
    // 回填生成时刻指纹
    const topic = JSON.parse(fs.readFileSync(path.join(dir, "topic.json"), "utf8"));
    topic.summaryEvidence.transcriptHash = fp;
    fs.writeFileSync(path.join(dir, "topic.json"), JSON.stringify(topic));
    // 默认 verify(无 expectHash)→ 读引擎绑定 → 通过
    expect(verifyEvidence(dir).ok).toBe(true);
    // 篡改 transcript → 默认 verify 失败(不依赖用户手动 expect-hash)
    fs.appendFileSync(path.join(dir, TRANSCRIPT_FILE), "\"tamper\"\n");
    const r = verifyEvidence(dir);
    expect(r.hashMatch).toBe(false);
    expect(r.ok).toBe(false);
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
