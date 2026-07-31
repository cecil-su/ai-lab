import { describe, expect, it } from "vitest";
import { adapterResumable, isResumableProvider, resolveAdapter } from "../src/adapters/registry.js";

describe("capabilities: resumableSession 声明与真值表 (Phase-3 ②)", () => {
  it("claude/codex/opencode 声明可续接会话", () => {
    expect(resolveAdapter("claude").capabilities?.resumableSession).toBe(true);
    expect(resolveAdapter("codex").capabilities?.resumableSession).toBe(true);
    expect(resolveAdapter("opencode").capabilities?.resumableSession).toBe(true);
  });

  it("reasonix/mock 不可续接(缺省 false)", () => {
    expect(resolveAdapter("reasonix").capabilities?.resumableSession ?? false).toBe(false);
    expect(resolveAdapter("mock:/x/s.json").capabilities?.resumableSession ?? false).toBe(false);
  });

  it("adapterResumable 优先声明,缺省走真值表", () => {
    expect(adapterResumable("claude")).toBe(true);
    expect(adapterResumable("reasonix")).toBe(false);
    expect(isResumableProvider("claude")).toBe(true);
    expect(isResumableProvider("codex")).toBe(true);
    expect(isResumableProvider("opencode")).toBe(true);
    expect(isResumableProvider("reasonix")).toBe(false);
    expect(isResumableProvider("mock")).toBe(false);
    expect(isResumableProvider("unknown-provider")).toBe(false);
  });

  it("注入 resolver 可覆盖声明(测试/嵌入方)", () => {
    const fake = (spec: string) => ({
      name: spec,
      capabilities: { codeAccess: "inherited" as const, resumableSession: true },
      async detect() { return { ok: true }; },
      async speak() { throw new Error("unused"); },
    });
    expect(adapterResumable("reasonix", fake)).toBe(true);
  });
});
