import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdContinue, cmdNew } from "../src/commands.js";
import { createTopic, loadTopic } from "../src/store/topic.js";
import { runTopic } from "../src/engine/runner.js";
import { readTranscript } from "../src/store/transcript.js";
import { makeTmpDir, removeDir } from "./helpers.js";

function writeScript(dir: string, name: string, speeches: string[]): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ speeches }));
  return `mock:${file}`;
}

describe("cmdContinue 续谈(R3 方案 B)", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    removeDir(root);
    vi.restoreAllMocks();
  });

  async function makeCompletedTopic(id: string): Promise<string> {
    const p1 = writeScript(root, `${id}-1.json`, ["A1\n【立场】a1", "A2\n【立场】a2", "总结A", "追加A", "再追加A"]);
    const p2 = writeScript(root, `${id}-2.json`, ["B1\n【立场】b1", "B2\n【立场】b2", "总结B", "追加B", "再追加B"]);
    createTopic(root, {
      id,
      title: "续谈话题",
      mode: "roundtable",
      maxRounds: 2,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "a" },
        { handle: "mock-2", provider: p2, perspective: "b" },
      ],
    });
    const dir = path.join(root, id);
    await runTopic(dir, { installSignalHandlers: false });
    expect(loadTopic(dir).status).toBe("completed");
    return dir;
  }

  it("completed 无 flag → 拒绝并提示", async () => {
    const dir = await makeCompletedTopic("no-flag");
    const before = readTranscript(dir).length;
    const code = await cmdContinue(["no-flag"], {}, { root });
    expect(code).toBe(1);
    expect(readTranscript(dir).length).toBe(before); // 未改动
  });

  it("--ask 重开:注入 human 事件、追加新一轮、seq 连续、summary 重生成", async () => {
    const dir = await makeCompletedTopic("with-ask");
    const before = readTranscript(dir);
    const summaryBefore = fs.readFileSync(path.join(dir, "summary.md"), "utf8");

    const code = await cmdContinue(["with-ask"], { ask: "针对成本再深入", more: "1" }, { root });
    expect(code).toBe(0);

    const after = readTranscript(dir);
    // human 事件已注入
    const human = after.find((e) => e.kind === "human" && e.body === "针对成本再深入");
    expect(human).toBeDefined();
    expect(human!.from).toBe("user");
    // 新增事件(比原来多)
    expect(after.length).toBeGreaterThan(before.length);
    // seq 连续无洞
    expect(after.map((e) => e.seq)).toEqual(after.map((_, i) => i + 1));
    // maxRounds 加了 1(2 → 3),状态回到 completed
    const topic = loadTopic(dir);
    expect(topic.maxRounds).toBe(3);
    expect(topic.status).toBe("completed");
    // summary 被重生成(内容变化)
    expect(fs.readFileSync(path.join(dir, "summary.md"), "utf8")).not.toBe(summaryBefore);
  });

  it("--as 指定插话人名", async () => {
    const dir = await makeCompletedTopic("with-as");
    await cmdContinue(["with-as"], { ask: "换个角度", as: "cecil" }, { root });
    const human = readTranscript(dir).find((e) => e.kind === "human");
    expect(human?.from).toBe("cecil");
  });

  it("F1:--timeout 非法值早退 1(不开题)", async () => {
    const p1 = writeScript(root, "to-a.json", ["x"]);
    const p2 = writeScript(root, "to-b.json", ["y"]);
    const code = await cmdNew(
      ["超时校验"],
      { providers: `${p1},${p2}`, timeout: "abc" },
      { root },
    );
    expect(code).toBe(1);
  });
});
