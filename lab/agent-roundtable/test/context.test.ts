import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContextMaterial, CONTEXT_MAX_BYTES } from "../src/engine/context.js";
import { makeTmpDir, removeDir } from "./helpers.js";

describe("buildContextMaterial (R1 注入)", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeDir(dir));

  it("无输入 → 空 material", () => {
    const r = buildContextMaterial({ files: [], cwd: dir });
    expect(r.material).toBe("");
    expect(r.entries).toHaveLength(0);
  });

  it("--context-file 注入内容并按扩展名加语言,label 用相对路径", () => {
    fs.writeFileSync(path.join(dir, "a.ts"), "const x = 1;\n");
    const r = buildContextMaterial({ files: ["a.ts"], cwd: dir });
    expect(r.material).toContain("## 参考材料");
    expect(r.material).toContain("### a.ts");
    expect(r.material).toContain("```ts");
    expect(r.material).toContain("const x = 1;");
    expect(r.entries).toEqual([{ label: "a.ts", bytes: Buffer.byteLength("const x = 1;\n") }]);
  });

  it("路径不存在 → 抛错", () => {
    expect(() => buildContextMaterial({ files: ["missing.ts"], cwd: dir })).toThrow(/不存在/);
  });

  it("--context-dir 非递归收集,--context-glob 过滤扩展名", () => {
    fs.writeFileSync(path.join(dir, "a.ts"), "A");
    fs.writeFileSync(path.join(dir, "b.md"), "B");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "c.ts"), "C"); // 不应被递归收集
    const r = buildContextMaterial({ files: [], dir: ".", glob: "*.ts", cwd: dir });
    expect(r.entries.map((e) => e.label)).toEqual(["a.ts"]);
  });

  it("超限时 overLimit=true(仍产出 material)", () => {
    fs.writeFileSync(path.join(dir, "big.md"), "x".repeat(CONTEXT_MAX_BYTES + 1));
    const r = buildContextMaterial({ files: ["big.md"], cwd: dir });
    expect(r.overLimit).toBe(true);
    expect(r.material).not.toBe("");
  });
});
