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
    expect(topic.version).toBe(2);
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

  it("loadTopic 迁移 v1 裸字符串 sessionRef → 结构化 SessionRef(ADR 0032)", () => {
    const topic = createTopic(root, INPUT);
    const dir = path.join(root, INPUT.id);
    // 构造旧 v1 数据:version=1,participants[].sessionRef 是裸字符串 / @last
    const legacy = JSON.parse(fs.readFileSync(path.join(dir, "topic.json"), "utf8"));
    legacy.version = 1;
    legacy.participants[0].sessionRef = "sid-123"; // claude:成功会话
    legacy.participants[1].sessionRef = "@last"; // 降级哨兵
    fs.writeFileSync(path.join(dir, "topic.json"), JSON.stringify(legacy));

    const loaded = loadTopic(dir);
    expect(loaded.version).toBe(2); // 惰性升级
    expect(loaded.participants[0]!.sessionRef).toEqual({
      provider: "claude",
      value: "sid-123",
      trust: "verified",
      resumable: true,
    });
    expect(loaded.participants[1]!.sessionRef).toMatchObject({ trust: "degraded", resumable: false });
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
    // F2:completed → active 合法化(续谈重开)
    expect(transition(topic, "active").status).toBe("active");
    // F2:幂等——同态重设为 no-op,返回原 topic 不抛
    expect(transition(topic, "completed")).toBe(topic);
    expect(transition({ ...topic, status: "active" }, "active").status).toBe("active");
    // 仍非法的转移照旧抛错
    expect(() => transition(topic, "paused")).toThrow(/invalid status transition/);
  });

  it("status machine 支持 cancelled 终态与续谈重开 (①)", () => {
    let topic = createTopic(root, INPUT);
    topic = transition(topic, "cancelled"); // active → cancelled
    expect(topic.status).toBe("cancelled");
    expect(transition(topic, "active").status).toBe("active"); // cancelled → active 续谈
    let t2 = transition(createTopic(root, { ...INPUT, id: "c2" }), "paused");
    expect(transition(t2, "cancelled").status).toBe("cancelled"); // paused → cancelled
    // completed 不能直接转 cancelled(只能 →active)
    expect(() => transition({ ...topic, status: "completed" }, "cancelled")).toThrow(/invalid/);
    void t2;
  });

  it("loadTopic 兼容:旧 completed 即使有累计失败也保持 outcome unknown (①)", () => {
    createTopic(root, INPUT);
    const dir = path.join(root, INPUT.id);
    const legacy = JSON.parse(fs.readFileSync(path.join(dir, "topic.json"), "utf8"));
    legacy.status = "completed";
    delete legacy.outcome;
    fs.writeFileSync(path.join(dir, "topic.json"), JSON.stringify(legacy));
    expect(loadTopic(dir).outcome).toBeUndefined(); // 也可能是旧版 finalizer 失败,结果未知

    legacy.participants[0].failures = 1;
    fs.writeFileSync(path.join(dir, "topic.json"), JSON.stringify(legacy));
    // participant failure 可能与 finalizer failure 同时发生,不能可靠选择 degraded/failed。
    expect(loadTopic(dir).outcome).toBeUndefined();
  });

  it("createTopic 持久化 capabilities 快照;旧 topic 无快照按真值表推导 (②)", () => {
    const topic = createTopic(root, {
      ...INPUT,
      capabilities: {
        "claude-architect": { resumableSession: true },
        "codex-redteam": { resumableSession: true },
      },
    });
    expect(topic.capabilities).toEqual({
      "claude-architect": { resumableSession: true },
      "codex-redteam": { resumableSession: true },
    });
    // 旧格式:磁盘上删掉 capabilities → 加载时按 provider base 真值表推导
    const dir = path.join(root, INPUT.id);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "topic.json"), "utf8"));
    delete raw.capabilities;
    fs.writeFileSync(path.join(dir, "topic.json"), JSON.stringify(raw));
    const loaded = loadTopic(dir);
    expect(loaded.capabilities?.["claude-architect"]?.resumableSession).toBe(true);
    expect(loaded.capabilities?.["codex-redteam"]?.resumableSession).toBe(true);
    // reasonix/mock 推导为 false
    const r = createTopic(root, {
      id: "rx",
      title: "x",
      mode: "roundtable",
      maxRounds: 1,
      participants: [{ handle: "rx-1", provider: "reasonix", perspective: "a" }],
    });
    const rdir = path.join(root, "rx");
    const rraw = JSON.parse(fs.readFileSync(path.join(rdir, "topic.json"), "utf8"));
    delete rraw.capabilities;
    fs.writeFileSync(path.join(rdir, "topic.json"), JSON.stringify(rraw));
    expect(loadTopic(rdir).capabilities?.["rx-1"]?.resumableSession).toBe(false);
    void r;
  });

  it("listTopics returns topics and ignores stray dirs", () => {
    createTopic(root, INPUT);
    createTopic(root, { ...INPUT, id: "another-topic" });
    fs.mkdirSync(path.join(root, "not-a-topic"));
    expect(listTopics(root).map((t) => t.id).sort()).toEqual(["2026-07-29-cache", "another-topic"]);
    expect(listTopics(path.join(root, "missing"))).toEqual([]);
  });
});
