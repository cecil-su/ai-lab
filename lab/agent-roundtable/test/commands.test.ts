import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdStop, listView, slugify } from "../src/commands.js";
import { createTopic, listTopics, loadTopic } from "../src/store/topic.js";
import { makeTmpDir, removeDir } from "./helpers.js";

describe("listView (list --json 结构)", () => {
  let root: string;
  beforeEach(() => (root = makeTmpDir()));
  afterEach(() => removeDir(root));

  it("projects topics to json-friendly views with round progress and base provider", () => {
    createTopic(root, {
      id: "2026-07-30-a",
      title: "话题甲",
      mode: "roundtable",
      maxRounds: 3,
      participants: [
        { handle: "mock-1", provider: "mock:/abs/script.json", perspective: "架构" },
        { handle: "claude-1", provider: "claude", perspective: "安全" },
      ],
    });
    createTopic(root, {
      id: "2026-07-30-b",
      title: "话题乙",
      mode: "debate",
      maxRounds: 2,
      participants: [{ handle: "codex-1", provider: "codex", perspective: "成本" }],
    });

    const views = listView(listTopics(root));
    expect(views).toHaveLength(2);
    const a = views.find((v) => v.id === "2026-07-30-a")!;
    expect(a).toMatchObject({
      title: "话题甲",
      mode: "roundtable",
      status: "active",
      round: { current: 0, max: 3 },
    });
    // mock:<path> 的展示基名收敛为 "mock"
    expect(a.participants.map((p) => p.provider)).toEqual(["mock", "claude"]);
    expect(a.participants[0]).toMatchObject({ handle: "mock-1", tokens: { input: 0, cached: 0, output: 0 } });
  });
});

describe("cmdStop 无 runner 补 summary (#8)", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    removeDir(root);
  });

  it("active 话题无 runner:置 completed 且写终止 summary", () => {
    createTopic(root, {
      id: "t",
      title: "x",
      mode: "roundtable",
      maxRounds: 3,
      participants: [{ handle: "mock-1", provider: "mock:/abs/s.json", perspective: "架构" }],
    });
    const dir = path.join(root, "t");
    expect(loadTopic(dir).status).toBe("active");

    const code = cmdStop(["t"], {}, { root });

    expect(code).toBe(0);
    expect(loadTopic(dir).status).toBe("completed");
    // 不再产出无 summary 的伪完成
    expect(fs.existsSync(path.join(dir, "summary.md"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "summary.md"), "utf8")).toContain("人工终止");
  });
});

describe("slugify (A5:中文标题产出可辨认 id)", () => {
  it("保留中文,不塌成空", () => {
    const s = slugify("服务端缓存选型:Redis vs 进程内存");
    expect(s).not.toBe("topic");
    expect(s).toContain("redis");
    expect(s).toContain("服务端缓存选型");
  });

  it("折叠空白与不安全字符,限长 60", () => {
    expect(slugify("a b/c")).toBe("a-b-c");
    expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(60);
  });

  it("纯符号/空标题回退 topic", () => {
    expect(slugify("///")).toBe("topic");
    expect(slugify("")).toBe("topic");
  });
});
