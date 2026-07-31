import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTopic } from "../src/store/topic.js";
import { makeTmpDir, removeDir } from "./helpers.js";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function writeScript(dir: string, name: string, speeches: string[]): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ speeches }));
  return `mock:${file}`;
}

/** 真子进程跑内部命令 run-detached(mock providers,零 token) */
function runDetached(root: string, id: string): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI, "run-detached", id], {
      cwd: path.dirname(CLI),
      env: { ...process.env, ROUNDTABLE_HOME: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (out += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (out += c));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, log: out }));
  });
}

describe("detach 后台运行 (Phase-3 ⑤)", () => {
  let root: string;
  beforeEach(() => (root = makeTmpDir()));
  afterEach(() => removeDir(root));

  it("run-detached 子进程跑完:退出码 0、completed、run.log 由父进程 spawn 时落盘(见 cmdNew --detach 集成)", async () => {
    const p1 = writeScript(root, "a.json", ["观点A\n【立场】A", "总结A"]);
    const p2 = writeScript(root, "b.json", ["观点B\n【立场】B", "总结B"]);
    createTopic(root, {
      id: "det",
      title: "后台",
      mode: "roundtable",
      maxRounds: 1,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "a" },
        { handle: "mock-2", provider: p2, perspective: "b" },
      ],
    });
    const { code, log } = await runDetached(root, "det");
    expect(code).toBe(0); // completed → 0
    expect(log).toContain("completed");
    const t = JSON.parse(fs.readFileSync(path.join(root, "det", "topic.json"), "utf8"));
    expect(t.status).toBe("completed");
    expect(t.outcome).toBe("success");
  });

  it("paused 话题 run-detached 退出码 2(可续语义)", async () => {
    const p1 = writeScript(root, "c.json", ["观点A\n【立场】A", "总结A"]);
    const p2 = writeScript(root, "d.json", ["观点B\n【立场】B", "总结B"]);
    createTopic(root, {
      id: "det-paused",
      title: "后台暂停",
      mode: "roundtable",
      maxRounds: 2,
      participants: [
        { handle: "mock-1", provider: p1, perspective: "a" },
        { handle: "mock-2", provider: p2, perspective: "b" },
      ],
    });
    // 预算 1:第 1 次发言后耗尽 → paused(可续)
    const t = JSON.parse(fs.readFileSync(path.join(root, "det-paused", "topic.json"), "utf8"));
    t.maxCalls = 1;
    fs.writeFileSync(path.join(root, "det-paused", "topic.json"), JSON.stringify(t));
    const { code } = await runDetached(root, "det-paused");
    expect(code).toBe(2); // paused → 2
    const after = JSON.parse(fs.readFileSync(path.join(root, "det-paused", "topic.json"), "utf8"));
    expect(after.status).toBe("paused");
  });
});
