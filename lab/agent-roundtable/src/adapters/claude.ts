import { detectSimple } from "../doctor.js";
import { execProvider } from "./exec.js";
import type { ProviderAdapter, SpeakResult } from "./types.js";

// claude 2.1.220 实测锚点:
//   新会话  claude -p --output-format json --tools ""(--tools "" 禁全部工具,讨论不需要且压 token)
//   续接    追加 --resume <session_id>
//   prompt 经 stdin;输出为单个 JSON 对象:result / session_id / is_error / usage.{input_tokens,...}
const BASE_ARGS = ["-p", "--output-format", "json", "--tools", ""];

interface ClaudeJson {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  session_id?: string;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}

/** 纯解析,供单测:claude -p --output-format json 的 stdout → SpeakResult */
export function parseClaudeOutput(stdout: string): SpeakResult {
  let json: ClaudeJson;
  try {
    json = JSON.parse(stdout) as ClaudeJson;
  } catch {
    throw new Error(`claude 输出不是合法 JSON: ${stdout.trim().slice(0, 200)}`);
  }
  if (json.is_error || json.subtype !== "success") {
    throw new Error(`claude 返回错误(subtype=${json.subtype}): ${String(json.result).slice(0, 200)}`);
  }
  if (typeof json.result !== "string" || typeof json.session_id !== "string") {
    throw new Error("claude 输出缺少 result/session_id 字段");
  }
  const u = json.usage;
  return {
    text: json.result,
    sessionRef: json.session_id,
    tokens: u
      ? {
          // input 记"本次处理的全部上下文"(新增 + 缓存写 + 缓存读),与其他家口径一致
          input:
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0),
          output: u.output_tokens ?? 0,
        }
      : undefined,
  };
}

export const claudeAdapter: ProviderAdapter = {
  name: "claude",

  detect: () => detectSimple("claude", "claude", ["--version"]),

  async speak({ prompt, sessionRef, model, cwd, timeoutMs }) {
    const args = [...BASE_ARGS];
    if (model) args.push("--model", model);
    if (sessionRef) args.push("--resume", sessionRef);
    const { stdout } = await execProvider({
      provider: "claude",
      cmd: "claude",
      args,
      cwd,
      timeoutMs,
      stdin: prompt,
    });
    return parseClaudeOutput(stdout);
  },
};
