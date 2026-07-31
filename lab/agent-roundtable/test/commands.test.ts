import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdNew, cmdStop, inheritedProviders, listView, slugify } from "../src/commands.js";
import type { ProviderAdapter } from "../src/adapters/types.js";
import { makeVerified } from "../src/adapters/types.js";
import { runTopic } from "../src/engine/runner.js";
import { createTopic, listTopics, loadTopic, saveTopic, transition } from "../src/store/topic.js";
import { makeTmpDir, removeDir } from "./helpers.js";

describe("inheritedProviders：--repo 安全策略判定 (②)", () => {
  it("全 enforced(claude/codex)→ 空(无需 unsafe override)", () => {
    expect(inheritedProviders(["claude", "codex"])).toEqual([]);
  });
  it("点名 inherited(opencode/reasonix),去重", () => {
    expect(inheritedProviders(["opencode", "reasonix", "claude"]).sort()).toEqual(["opencode", "reasonix"]);
  });
  it("mock 不计入(isMockSpec 排除)", () => {
    expect(inheritedProviders(["mock:/x/s.json", "opencode"])).toEqual(["opencode"]);
  });
});

describe("cmdNew --repo capabilities enforcement (②)", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    removeDir(root);
  });

  const resolver = (spec: string): ProviderAdapter => {
    const enforced = spec === "claude" || spec === "codex";
    return {
      name: spec,
      capabilities: { codeAccess: enforced ? "enforced" : "inherited" },
      async detect() { return { ok: true }; },
      async speak() {
        return {
          text: `来自 ${spec} 的正文`,
          sessionRef: makeVerified(spec, `${spec}-session`),
          tokens: { input: 1, cached: 0, output: 1 },
        };
      },
    };
  };

  it("provider@model 每参与者模型:spec 内嵌优先于全局 --model", async () => {
    const seen: string[] = [];
    const resolver = (spec: string): ProviderAdapter => ({
      name: spec,
      capabilities: { codeAccess: "enforced" },
      async detect() { return { ok: true }; },
      async speak(o) {
        seen.push(`${spec}:${o.model ?? "(none)"}`);
        return { text: "正文x", sessionRef: makeVerified(spec, "s"), tokens: { input: 1, cached: 0, output: 1 } };
      },
    });
    const code = await cmdNew(
      ["每参与者模型"],
      { providers: "claude@m-claude,codex@m-codex,opencode", "max-rounds": "1", model: "m-global" },
      { root, resolveAdapter: resolver },
    );
    expect(code).toBe(0);
    expect(seen).toContain("claude:m-claude");
    expect(seen).toContain("codex:m-codex");
    expect(seen).toContain("opencode:m-global"); // 未内嵌 → 全局 --model
  });

  it("inherited + --repo 无覆盖 → 非零且不创建话题", async () => {
    const code = await cmdNew(
      ["拒绝不安全自读"],
      { providers: "opencode,reasonix", repo: root, "max-rounds": "1" },
      { root, resolveAdapter: resolver },
    );
    expect(code).toBe(1);
    expect(listTopics(root)).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--allow-unsafe-repo"));
  });

  it("inherited + 显式覆盖 → 创建并保留实验性告警", async () => {
    const code = await cmdNew(
      ["接受不安全自读"],
      {
        providers: "opencode,reasonix",
        repo: root,
        "allow-unsafe-repo": true,
        "max-rounds": "1",
      },
      { root, resolveAdapter: resolver },
    );
    expect(code).toBe(0);
    expect(listTopics(root)).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("自读为实验特性"));
  });

  it("全 enforced + --repo → 允许创建,但仍披露 prompt/plugin 非隔离风险", async () => {
    const code = await cmdNew(
      ["安全只读仍需披露"],
      { providers: "claude,codex", repo: root, "max-rounds": "1" },
      { root, resolveAdapter: resolver },
    );
    expect(code).toBe(0);
    expect(listTopics(root)).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("各家均强制只读"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("项目指令/plugin/hook"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("不构成安全隔离"));
  });
});

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
    // Phase-3 ②:会话可续性随 topic 快照投影(mock → false)
    expect(a.participants.map((p) => p.resumableSession)).toEqual([false, true]); // mock / claude
    const b = views.find((v) => v.id === "2026-07-30-b")!;
    expect(b.participants[0]!.resumableSession).toBe(true); // codex
  });

  it("非 completed 即使磁盘残留旧 outcome 也不向 list 投影", () => {
    const topic = createTopic(root, {
      id: "stale-outcome",
      title: "重开中",
      mode: "roundtable",
      maxRounds: 1,
      participants: [{ handle: "mock-1", provider: "mock:/abs/script.json", perspective: "架构" }],
    });
    expect(listView([{ ...topic, status: "active", outcome: "failed" }])[0]!.outcome).toBeUndefined();
    expect(listView([{ ...topic, status: "cancelled", outcome: "degraded" }])[0]!.outcome).toBeUndefined();
  });
});

describe("cmdStop 无 runner → cancelled + summary (#8/①)", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    removeDir(root);
  });

  it("active 话题无 runner:置 cancelled 且写终止 summary,engine 不会静默重启", async () => {
    createTopic(root, {
      id: "t",
      title: "x",
      mode: "roundtable",
      maxRounds: 3,
      participants: [{ handle: "mock-1", provider: "mock:/abs/s.json", perspective: "架构" }],
    });
    const dir = path.join(root, "t");
    expect(loadTopic(dir).status).toBe("active");
    saveTopic(dir, { ...loadTopic(dir), outcome: "failed" }); // 模拟重开后遗留的旧代结果

    const code = cmdStop(["t"], {}, { root });

    expect(code).toBe(0);
    // ①:人工无收尾终止 → cancelled(而非 completed)
    expect(loadTopic(dir).status).toBe("cancelled");
    expect(loadTopic(dir).outcome).toBeUndefined();
    // 仍维持"终态 ⇒ summary 存在"不变量,不产伪完成
    expect(fs.existsSync(path.join(dir, "summary.md"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "summary.md"), "utf8")).toContain("人工终止");
    // runTopic API 不得绕过 cmdContinue 的显式重开协议。
    const unchanged = await runTopic(dir, {
      installSignalHandlers: false,
      resolveAdapter: () => { throw new Error("cancelled 不应解析 adapter"); },
    });
    expect(unchanged.status).toBe("cancelled");
    // 显式 transition 后仍可由 continue 重开。
    expect(transition(loadTopic(dir), "active").status).toBe("active");
  });
});

describe("终审⑥:README 能力叙述一致性", () => {
  it("detach 已实现,不再声称属 v2", () => {
    const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
    // detach 已实现:不再出现在 v2 预留列表中,且不得再声称"后台 daemon / detach 是 v2"
    expect(readme).toContain("--detach` 后台运行");
    expect(readme).not.toContain("后台 daemon(detach 不中断讨论)");
    expect(readme).not.toContain("后台 daemon / detach 是 v2");
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
