import { detectSimple } from "../doctor.js";
import { execProvider } from "./exec.js";
import type { ProviderAdapter, SpeakResult } from "./types.js";

// claude 2.1.220 实测锚点:
//   新会话  claude -p --output-format json --tools ""(--tools "" 禁全部工具,讨论不需要且压 token)
//   续接    追加 --resume <session_id>
//   prompt 经 stdin;输出为单个 JSON 对象:result / session_id / is_error / usage.{input_tokens,...}
//   自读(R2):codeAccess 时不禁工具,改 plan 模式(只读,禁写)+ 放开 Read/Grep/Glob,
//             让它在代码仓库 cwd 下自行检索。已真机核准(2.1.220,2026-07-30:plan+allowedTools
//             能读文件、permission_denials 空、无写入);`doctor --readonly` 可复验,防 flag 漂移。
const BASE_ARGS = ["-p", "--output-format", "json"];
const DISCUSS_ONLY_ARGS = ["--tools", ""];
const READONLY_ARGS = ["--permission-mode", "plan", "--allowedTools", "Read", "Grep", "Glob"];

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
          // input = 本次新处理(新增 + 缓存写,均全额计费);cached = 缓存读(廉价)
          input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          cached: u.cache_read_input_tokens ?? 0,
          output: u.output_tokens ?? 0,
        }
      : undefined,
  };
}

/** 纯参数构造,供单测:讨论态禁工具,自读态开只读工具集 */
export function buildClaudeArgs(opts: { model?: string; sessionRef?: string; codeAccess?: boolean }): string[] {
  const args = [...BASE_ARGS, ...(opts.codeAccess ? READONLY_ARGS : DISCUSS_ONLY_ARGS)];
  if (opts.model) args.push("--model", opts.model);
  if (opts.sessionRef) args.push("--resume", opts.sessionRef);
  return args;
}

export const claudeAdapter: ProviderAdapter = {
  name: "claude",

  detect: () => detectSimple("claude", "claude", ["--version"]),

  async speak({ prompt, sessionRef, model, cwd, codeAccess, timeoutMs }) {
    const args = buildClaudeArgs({ model, sessionRef, codeAccess });
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
