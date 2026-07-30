import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTopic,
  listTopics,
  loadTopic,
  saveTopic,
  transition,
  type CreateTopicInput,
} from "../src/store/topic.js";
import { makeTmpDir, removeDir } from "./helpers.js";

const INPUT: CreateTopicInput = {
  id: "2026-07-29-cache",
  title: "缓存选型",
  mode: "debate",
  maxRounds: 3,
  participants: [
    { handle: "claude-architect", provider: "claude", perspective: "architect" },
    { handle: "codex-redteam", provider: "codex", perspective: { custom: "唱反调" }, model: "gpt-x" },
  ],
};

describe("topic store", () => {
  let root: string;
  beforeEach(() => (root = makeTmpDir()));
  afterEach(() => removeDir(root));

  it("createTopic fills defaults and persists", () => {
    const topic = createTopic(root, INPUT);
    expect(topic.version).toBe(1);
    expect(topic.status).toBe("active");
    expect(topic.currentRound).toBe(0);
    expect(topic.participants[0]).toMatchObject({
      transport: "local",
      model: null,
      sessionRef: null,
      tokens: { input: 0, output: 0 },
    });
    expect(topic.participants[1]!.model).toBe("gpt-x");
    expect(loadTopic(path.join(root, INPUT.id))).toEqual(topic);
  });

  it("loadTopic 向后兼容:旧 topic.json 缺 tokens.cached 时默认 0", () => {
    const topic = createTopic(root, INPUT);
    const dir = path.join(root, INPUT.id);
    // 模拟旧数据:抹掉 cached 字段写回
    const legacy = JSON.parse(fs.readFileSync(path.join(dir, "topic.json"), "utf8"));
    for (const p of legacy.participants) delete p.tokens.cached;
    fs.writeFileSync(path.join(dir, "topic.json"), JSON.stringify(legacy));
    const loaded = loadTopic(dir);
    expect(loaded.participants[0]!.tokens).toEqual({ input: 0, cached: 0, output: 0 });
    void topic;
  });

  it("createTopic rejects duplicate id", () => {
    createTopic(root, INPUT);
    expect(() => createTopic(root, INPUT)).toThrow(/already exists/);
  });

  it("saveTopic round-trips", () => {
    const topic = createTopic(root, INPUT);
    const dir = path.join(root, INPUT.id);
    saveTopic(dir, { ...topic, currentRound: 2 });
    expect(loadTopic(dir).currentRound).toBe(2);
  });

  it("status machine allows only defined transitions", () => {
    let topic = createTopic(root, INPUT);
    topic = transition(topic, "paused");
    topic = transition(topic, "active");
    topic = transition(topic, "completed");
    expect(topic.status).toBe("completed");
    expect(() => transition(topic, "active")).toThrow(/invalid status transition/);
    expect(() => transition({ ...topic, status: "active" }, "active")).toThrow(
      /invalid status transition/,
    );
  });

  it("listTopics returns topics and ignores stray dirs", () => {
    createTopic(root, INPUT);
    createTopic(root, { ...INPUT, id: "another-topic" });
    fs.mkdirSync(path.join(root, "not-a-topic"));
    expect(listTopics(root).map((t) => t.id).sort()).toEqual(["2026-07-29-cache", "another-topic"]);
    expect(listTopics(path.join(root, "missing"))).toEqual([]);
  });
});
