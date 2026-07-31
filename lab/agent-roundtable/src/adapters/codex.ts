import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectSimple } from "../doctor.js";
import { execProvider } from "./exec.js";
import { makeVerified, type ProviderAdapter, type SpeakResult } from "./types.js";

// codex 0.145.0 实测锚点:
//   新会话  codex exec --json -s read-only --skip-git-repo-check -(prompt 经 stdin,`-` 占位)
//   续接    codex exec resume <thread_id> --json --skip-git-repo-check -
//           (resume 子命令不认 -s,只能 -c sandbox_mode="read-only" 覆盖配置)
//   JSONL 事件流:thread.started→thread_id;item.completed(item.type=agent_message)→正文;
//   turn.completed→usage.{input_tokens,cached_input_tokens,output_tokens}
//   兜底:-o <file> 落盘末条消息,事件流缺 agent_message 时用它

interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: { type?: string; text?: string };
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
  message?: string;
}

/** 纯解析,供单测:codex exec --json 的 JSONL stdout → SpeakResult(容忍非 JSON 行) */
export function parseCodexEvents(stdout: string, fallbackText?: string): SpeakResult {
  let threadId: string | undefined;
  let text: string | undefined;
  let tokens: SpeakResult["tokens"];
  let errorMessage: string | undefined;
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch {
      continue; // 非 JSON 行(横幅/告警)跳过
    }
    if (event.type === "thread.started" && event.thread_id) threadId = event.thread_id;
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      text = event.item.text; // 取最后一条 agent message
    }
    if (event.type === "turn.completed" && event.usage) {
      // codex 的 input_tokens 是含缓存的总量,cached_input_tokens 是其中缓存读的子集
      const total = event.usage.input_tokens ?? 0;
      const cached = event.usage.cached_input_tokens ?? 0;
      tokens = {
        input: Math.max(0, total - cached),
        cached,
        output: event.usage.output_tokens ?? 0,
      };
    }
    if (event.type === "error") errorMessage = event.message;
  }
  if (errorMessage !== undefined) throw new Error(`codex 事件流报错: ${errorMessage}`);
  if (threadId === undefined) throw new Error("codex 事件流中未捕获 thread.started/thread_id");
  if (text === undefined && fallbackText !== undefined && fallbackText.trim() !== "") {
    text = fallbackText.trim();
  }
  if (text === undefined) throw new Error("codex 事件流中没有 agent_message");
  return { text, sessionRef: makeVerified("codex", threadId), tokens };
}

export const codexAdapter: ProviderAdapter = {
  name: "codex",
  capabilities: { codeAccess: "enforced" }, // -s read-only / sandbox_mode 强制只读

  detect: () => detectSimple("codex", "codex", ["--version"]),

  async speak({ prompt, sessionRef, model, cwd, timeoutMs }) {
    const lastMessageFile = path.join(os.tmpdir(), `roundtable-codex-${crypto.randomUUID()}.txt`);
    const args = sessionRef
      ? ["exec", "resume", sessionRef.value, "--json", "--skip-git-repo-check", "-c", 'sandbox_mode="read-only"']
      : ["exec", "--json", "-s", "read-only", "--skip-git-repo-check"];
    if (model) args.push("-m", model);
    args.push("-o", lastMessageFile);
    args.push("-"); // prompt 从 stdin 读
    try {
      const { stdout } = await execProvider({
        provider: "codex",
        cmd: "codex",
        args,
        cwd,
        timeoutMs,
        stdin: prompt,
      });
      const fallback = fs.existsSync(lastMessageFile)
        ? fs.readFileSync(lastMessageFile, "utf8")
        : undefined;
      return parseCodexEvents(stdout, fallback);
    } finally {
      fs.rmSync(lastMessageFile, { force: true });
    }
  },
};
