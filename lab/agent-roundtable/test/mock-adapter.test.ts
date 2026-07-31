import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAdapter } from "../src/adapters/mock.js";
import { makeVerified } from "../src/adapters/types.js";
import { makeTmpDir, removeDir } from "./helpers.js";

describe("mock adapter", () => {
  let dir: string;
  let scriptPath: string;
  beforeEach(() => {
    dir = makeTmpDir();
    scriptPath = path.join(dir, "script.json");
    fs.writeFileSync(scriptPath, JSON.stringify({ speeches: ["第一轮观点", "第二轮观点", "第三轮观点"] }));
  });
  afterEach(() => removeDir(dir));

  const speakOpts = { prompt: "议题", cwd: ".", timeoutMs: 1000 };

  it("detect reports ok", async () => {
    await expect(createMockAdapter(scriptPath).detect()).resolves.toEqual({ ok: true, version: "mock" });
  });

  it("session continuation walks through the script", async () => {
    const adapter = createMockAdapter(scriptPath);
    const first = await adapter.speak(speakOpts);
    expect(first.text).toBe("第一轮观点");
    expect(first.sessionRef.value).toBe("1");
    expect(first.tokens?.output).toBeGreaterThan(0);

    const second = await adapter.speak({ ...speakOpts, sessionRef: first.sessionRef });
    expect(second.text).toBe("第二轮观点");
    expect(second.sessionRef.value).toBe("2");
  });

  it("clamps to the last speech when script runs out", async () => {
    const adapter = createMockAdapter(scriptPath);
    const result = await adapter.speak({ ...speakOpts, sessionRef: makeVerified("mock", "7") });
    expect(result.text).toBe("第三轮观点");
    expect(result.sessionRef.value).toBe("8");
  });

  it("rejects invalid sessionRef and empty script", async () => {
    const adapter = createMockAdapter(scriptPath);
    await expect(adapter.speak({ ...speakOpts, sessionRef: makeVerified("mock", "abc") })).rejects.toThrow(/invalid mock sessionRef/);
    fs.writeFileSync(scriptPath, JSON.stringify({ speeches: [] }));
    await expect(adapter.speak(speakOpts)).rejects.toThrow(/no speeches/);
  });
});
