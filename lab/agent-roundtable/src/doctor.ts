import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execProvider, ProviderExecError } from "./adapters/exec.js";

export interface ProviderDetection {
  name: string;
  ok: boolean;
  version?: string;
  error?: string;
}

// claude 只读姿态所用的 flag(与 adapters/claude.ts 的 READONLY_ARGS 对齐);doctor --readonly 据此实测
const CLAUDE_READONLY_ARGS = [
  "-p", "--output-format", "json",
  "--permission-mode", "plan",
  "--allowedTools", "Read", "Grep", "Glob",
];

const TIMEOUT_MS = 15_000;

function run(
  cmd: string,
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr.trim() || err.message).split("\n")[0] ?? "unknown error";
        resolve({ ok: false, error: detail });
      } else {
        resolve({ ok: true, stdout: stdout.trim() });
      }
    });
  });
}

function parseVersion(stdout: string): string | undefined {
  // 取首个含数字的 token,去掉前导非数字("2.1.220 (Claude Code)" / "codex-cli 0.145.0" / "reasonix npm-v1.8.0-rc.1")
  const token = stdout.split(/\s+/).find((t) => /\d/.test(t));
  return token?.replace(/^\D*/, "");
}

export async function detectSimple(name: string, cmd: string, args: string[]): Promise<ProviderDetection> {
  const result = await run(cmd, args);
  return result.ok
    ? { name, ok: true, version: parseVersion(result.stdout) }
    : { name, ok: false, error: result.error };
}

export async function detectReasonix(): Promise<ProviderDetection> {
  // Windows 上正确入口是 npm 全局的 reasonix.ps1(需经 pwsh 解析);
  // 直接 spawn 会命中 PATH 里 scoop 的同名旧版 reasonix.exe,仅作兜底
  if (process.platform === "win32") {
    const result = await run("pwsh", ["-NoProfile", "-Command", "reasonix version"]);
    if (result.ok) return { name: "reasonix", ok: true, version: parseVersion(result.stdout) };
  }
  return detectSimple("reasonix", "reasonix", ["version"]);
}

export async function detectAll(): Promise<ProviderDetection[]> {
  return Promise.all([
    detectSimple("claude", "claude", ["--version"]),
    detectSimple("codex", "codex", ["--version"]),
    detectSimple("opencode", "opencode", ["--version"]),
    detectReasonix(),
  ]);
}

/**
 * F11:实测 claude 只读 flag 是否生效(自读 --repo 依赖它)。在临时目录放一个带随机标记的探针文件,
 * 用只读 flag 让 claude 读取,PASS = flag 被接受、无报错、且回复含标记(证明能读且 flag 未漂移)。
 * 花少量 token,故仅 doctor --readonly 显式触发。
 */
export async function checkClaudeReadonly(): Promise<{ ok: boolean; detail: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roundtable-ro-"));
  const marker = "RO_" + crypto.randomUUID().slice(0, 8);
  fs.writeFileSync(path.join(dir, "probe.txt"), marker + "\n");
  try {
    const { stdout } = await execProvider({
      provider: "claude",
      cmd: "claude",
      args: CLAUDE_READONLY_ARGS,
      cwd: dir,
      timeoutMs: 90_000,
      stdin: "读取当前目录下的 probe.txt,把其中的标记词原样回给我。只读,不要写任何文件。",
    });
    const json = JSON.parse(stdout) as { is_error?: boolean; subtype?: string; result?: unknown };
    if (json.is_error || json.subtype !== "success") {
      return { ok: false, detail: `claude 返回错误(subtype=${json.subtype})` };
    }
    const ok = typeof json.result === "string" && json.result.includes(marker);
    return ok
      ? { ok: true, detail: "只读 flag 生效:claude 能在只读下读取文件" }
      : { ok: false, detail: "flag 未报错但未读到探针(只读工具可能未真正生效)" };
  } catch (e) {
    return { ok: false, detail: e instanceof ProviderExecError ? e.message : String(e) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function runDoctor(json: boolean, readonly = false): Promise<number> {
  const providers = await detectAll();
  const allOk = providers.every((p) => p.ok);
  const ro = readonly ? await checkClaudeReadonly() : undefined;
  if (json) {
    console.log(JSON.stringify({ ok: allOk && (ro?.ok ?? true), providers, ...(ro ? { claudeReadonly: ro } : {}) }));
  } else {
    for (const p of providers) {
      const detail = p.ok ? `ok       ${p.version ?? "?"}` : `missing  ${p.error ?? ""}`;
      console.log(`  ${p.name.padEnd(10)} ${detail}`.trimEnd());
    }
    if (ro) console.log(`  ${"claude只读".padEnd(10)} ${ro.ok ? "ok" : "FAIL"}     ${ro.detail}`);
  }
  return allOk && (ro?.ok ?? true) ? 0 : 1;
}
