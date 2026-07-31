import { detectSimple } from "../doctor.js";
import { execProvider } from "./exec.js";
import { makeVerified, type ProviderAdapter, type SpeakResult } from "./types.js";

// opencode 1.18.9 实测锚点:
//   新会话  opencode run --format json(prompt 经 stdin,实测跑通)
//   续接    追加 -s <sessionID>;模型覆盖 -m <provider/model>(不覆盖则用用户默认)
//   JSONL 事件流:每行一个事件,顶层 sessionID;type=text 的 part.text 为正文块;
//   type=step_finish 的 part.tokens.{input,output,cache.{read,write}} 为用量

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
    const args = ["run", "--format", "json"];
    if (sessionRef) args.push("-s", sessionRef.value);
    if (model) args.push("-m", model);
    const { stdout } = await execProvider({
      provider: "opencode",
      cmd: "opencode",
      args,
      cwd,
      timeoutMs,
      stdin: prompt,
    });
    return parseOpencodeEvents(stdout);
  },
};
