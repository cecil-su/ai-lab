import fs from "node:fs";
import { makeVerified, type ProviderAdapter } from "./types.js";

/**
 * 脚本步骤:字符串 = 正常发言;对象 = 注入故障(4 模型 debate 反馈项 4,零新基建验证降级/熔断路径)。
 * 按调用轮次索引(sessionRef turn),超界复用最后一步。
 */
export type MockStep = string | { text?: string; fail?: string };

interface MockScript {
  speeches: MockStep[];
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
      const step = script.speeches[Math.min(turn, script.speeches.length - 1)]!;
      if (typeof step !== "string") {
        if (step.fail !== undefined) throw new Error(step.fail); // 注入失败:走 speakOnce 降级路径
        if (step.text === undefined) throw new Error(`mock step ${turn} 无 text/fail: ${scriptPath}`);
        return {
          text: step.text,
          sessionRef: makeVerified("mock", String(turn + 1)),
          tokens: {
            input: Math.ceil(prompt.length / 4),
            cached: 0,
            output: Math.ceil(step.text.length / 4),
          },
        };
      }
      return {
        text: step,
        sessionRef: makeVerified("mock", String(turn + 1)),
        tokens: {
          input: Math.ceil(prompt.length / 4),
          cached: 0,
          output: Math.ceil(step.length / 4),
        },
      };
    },
  };
}
