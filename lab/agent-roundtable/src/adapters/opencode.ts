import { detectSimple } from "../doctor.js";
import { execProvider } from "./exec.js";
import { makeVerified, type ProviderAdapter, type SpeakResult } from "./types.js";

// opencode 1.18.10 实测锚点:
//   新会话  opencode run --format json --agent build(prompt 经 stdin,实测跑通)
//   续接    追加 -s <sessionID>;模型覆盖 -m <provider/model>(不覆盖则用用户默认)
//   JSONL 事件流:每行一个事件,顶层 sessionID;type=text 的 part.text 为正文块;
//   type=step_finish 的 part.tokens.{input,output,cache.{read,write}} 为用量
//
// ⚠ 长任务截断修复(2026-07-31 实测):opencode run 默认 agent 是用户插件的 orchestrator,
//   其完成语义是"派发任务",长评审会在中途 reason=stop(实测 4 步/59 字符);内置 build agent
//   走得更远但仍可能提前 stop(实测 8 步/560 字符)。故:固定 --agent build + 自动 -s 续跑,
//   直到续跑不再产出新正文(模型真正完成),最多 4 轮(1 首轮 + 3 续跑)。

const CONTINUE_PROMPT = "请继续完成上一条评审,输出最终完整结论。若已经完成,请只回复:已完成";
const MAX_RUNS = 4;

interface OpencodeEvent {
  type?: string;
  sessionID?: string;
  part?: {
    id?: string;
    type?: string;
    text?: string;
    tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } };
  };
}

/** 纯解析,供单测:opencode run --format json 的 stdout → SpeakResult */
export function parseOpencodeEvents(stdout: string): SpeakResult {
  let sessionId: string | undefined;
  // 按 part.id 去重(同一块若重复推送以最后一次为准),保持出现顺序
  const textParts = new Map<string, string>();
  let input = 0;
  let cached = 0;
  let output = 0;
  let sawTokens = false;
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    let event: OpencodeEvent;
    try {
      event = JSON.parse(line) as OpencodeEvent;
    } catch {
      continue;
    }
    if (event.sessionID) sessionId = event.sessionID;
    const part = event.part;
    if (event.type === "text" && part?.type === "text" && typeof part.text === "string") {
      textParts.set(part.id ?? String(textParts.size), part.text);
    }
    if (event.type === "step_finish" && part?.tokens) {
      sawTokens = true;
      // opencode 的 part.tokens.input 是含缓存的总 prompt 量,cache.read 是其中缓存读的子集
      input += part.tokens.input ?? 0;
      cached += part.tokens.cache?.read ?? 0;
      output += part.tokens.output ?? 0;
    }
  }
  if (sessionId === undefined) throw new Error("opencode 事件流中未捕获 sessionID");
  if (textParts.size === 0) throw new Error("opencode 事件流中没有 text 正文");
  return {
    text: [...textParts.values()].join("\n\n"),
    sessionRef: makeVerified("opencode", sessionId),
    tokens: sawTokens ? { input: Math.max(0, input - cached), cached, output } : undefined,
  };
}

export const opencodeAdapter: ProviderAdapter = {
  name: "opencode",
  capabilities: { codeAccess: "inherited", resumableSession: true }, // 仅换 cwd;session id 可稳定续接

  detect: () => detectSimple("opencode", "opencode", ["--version"]),

  async speak({ prompt, sessionRef, model, cwd, timeoutMs }) {
    let sessionId = sessionRef?.value;
    let text = "";
    const total = { input: 0, cached: 0, output: 0 };
    let sawTokens = false;
    // 首轮原文案;后续轮"请继续完成"——若模型已真正完成则不再产出新正文,收敛退出
    for (let attempt = 0; attempt < MAX_RUNS; attempt++) {
      const args = ["run", "--format", "json", "--agent", "build"];
      if (sessionId) args.push("-s", sessionId);
      if (model) args.push("-m", model);
      const { stdout } = await execProvider({
        provider: "opencode",
        cmd: "opencode",
        args,
        cwd,
        timeoutMs,
        stdin: attempt === 0 ? prompt : CONTINUE_PROMPT,
      });
      const parsed = parseOpencodeEvents(stdout);
      sessionId = parsed.sessionRef.value;
      if (parsed.tokens) {
        sawTokens = true;
        total.input += parsed.tokens.input ?? 0;
        total.cached += parsed.tokens.cached ?? 0;
        total.output += parsed.tokens.output ?? 0;
      }
      // 续跑无新增正文 → 模型已真正完成(收敛)
      if (attempt > 0 && parsed.text.length <= text.length) break;
      text = parsed.text;
    }
    return {
      text,
      sessionRef: makeVerified("opencode", sessionId!),
      tokens: sawTokens ? total : undefined,
    };
  },
};
