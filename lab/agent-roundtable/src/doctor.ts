import { execFile } from "node:child_process";

export interface ProviderDetection {
  name: string;
  ok: boolean;
  version?: string;
  error?: string;
}

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

export async function runDoctor(json: boolean): Promise<number> {
  const providers = await detectAll();
  const allOk = providers.every((p) => p.ok);
  if (json) {
    console.log(JSON.stringify({ ok: allOk, providers }));
  } else {
    for (const p of providers) {
      const detail = p.ok ? `ok       ${p.version ?? "?"}` : `missing  ${p.error ?? ""}`;
      console.log(`  ${p.name.padEnd(10)} ${detail}`.trimEnd());
    }
  }
  return allOk ? 0 : 1;
}
