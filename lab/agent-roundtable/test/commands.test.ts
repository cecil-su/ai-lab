import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listView } from "../src/commands.js";
import { createTopic, listTopics } from "../src/store/topic.js";
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
