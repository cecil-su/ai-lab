import fs from "node:fs";
import { makeVerified, type ProviderAdapter } from "./types.js";

interface MockScript {
  speeches: string[];
}

// 从脚本 JSON 读预设发言;sessionRef 是已发言次数,续接时从上次位置继续
export function createMockAdapter(scriptPath: string): ProviderAdapter {
  return {
    name: "mock",
    capabilities: { codeAccess: "inherited" }, // mock 不消费 codeAccess;会话为计数器,resumableSession 缺省 false

    async detect() {
      return { ok: true, version: "mock" };
    },

    async speak({ prompt, sessionRef }) {
      const script = JSON.parse(fs.readFileSync(scriptPath, "utf8")) as MockScript;
      if (!Array.isArray(script.speeches) || script.speeches.length === 0) {
        throw new Error(`mock script has no speeches: ${scriptPath}`);
      }
      const turn = sessionRef === undefined ? 0 : Number(sessionRef.value);
      if (!Number.isInteger(turn) || turn < 0) {
        throw new Error(`invalid mock sessionRef: ${String(sessionRef?.value)}`);
      }
      const text = script.speeches[Math.min(turn, script.speeches.length - 1)]!;
      return {
        text,
        sessionRef: makeVerified("mock", String(turn + 1)),
        tokens: {
          input: Math.ceil(prompt.length / 4),
          cached: 0,
          output: Math.ceil(text.length / 4),
        },
      };
    },
  };
}
