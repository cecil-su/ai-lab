import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectReasonix } from "../doctor.js";
import { execProvider, ProviderExecError } from "./exec.js";
import type { ProviderAdapter, SpeakResult } from "./types.js";

// reasonix 1.8.0-rc.1(npm 版)实测锚点:
//   新会话  reasonix run --max-steps 2 --metrics <tmp>(prompt 经 stdin)
//   续接    追加 --resume <会话 jsonl 绝对路径>(续接后追加写同一文件,路径稳定)
//   会话文件:%APPDATA%/reasonix/projects/<cwd 按 [:\/]→- 转写>/sessions/<ts>-<model>.jsonl
//   正文:stdout 纯文本,剔除 thinking 标记行 / "· codegraph:" 通知行 / "· N tok ·" 统计尾行
//   token:--metrics JSON 的 prompt_tokens / completion_tokens
//
// ⚠️ 本机双装坑:PATH 上 scoop 的 reasonix.exe(1.17.21)是错误入口;正确入口是 npm 全局的
// reasonix.ps1(内部为 node + bin/reasonix.js)。与 doctor.ts 同策略经 pwsh 解析出 ps1,
// 再直接 spawn node 跑 bin/reasonix.js —— 绕开 pwsh 管道对中文 stdin 的编码转写,超时也能杀准进程。

/** 新会话但未能定位会话文件时的降级 sessionRef:后续用 -c 续接该 cwd 下最近会话 */
export const REASONIX_LAST_SESSION = "@last";

interface ReasonixCmd {
  cmd: string;
  baseArgs: string[];
}

let cachedCmd: Promise<ReasonixCmd> | undefined;

function resolveReasonixCmd(): Promise<ReasonixCmd> {
  cachedCmd ??= (async () => {
    if (process.platform !== "win32") return { cmd: "reasonix", baseArgs: [] };
    const source = await new Promise<string>((resolve, reject) => {
      execFile(
        "pwsh",
        ["-NoProfile", "-Command", "(Get-Command reasonix).Source"],
        { timeout: 15_000, windowsHide: true },
        (err, stdout) =>
          err
            ? reject(new ProviderExecError("reasonix", `pwsh 解析 reasonix 入口失败: ${err.message}`))
            : resolve(stdout.trim()),
      );
    });
    if (!source.toLowerCase().endsWith(".ps1")) {
      throw new ProviderExecError(
        "reasonix",
        `解析到的入口不是 npm 版 reasonix.ps1(疑似 scoop 旧版):${source}`,
      );
    }
    const basedir = path.dirname(source);
    const entryJs = path.join(basedir, "node_modules", "reasonix", "bin", "reasonix.js");
    if (!fs.existsSync(entryJs)) {
      throw new ProviderExecError("reasonix", `未找到 npm 版入口脚本: ${entryJs}`);
    }
    const localNode = path.join(basedir, "node.exe");
    return { cmd: fs.existsSync(localNode) ? localNode : "node", baseArgs: [entryJs] };
  })();
  return cachedCmd;
}

/** cwd → reasonix 会话存储目录(项目目录名 = 绝对路径按 [:\/]→- 转写,大小写保留) */
export function reasonixSessionsDir(cwd: string): string {
  const root =
    process.platform === "win32"
      ? path.join(process.env["APPDATA"] ?? path.join(os.homedir(), "AppData", "Roaming"), "reasonix")
      : path.join(os.homedir(), ".config", "reasonix");
  const projectName = path.resolve(cwd).replace(/[:\\/]/g, "-");
  return path.join(root, "projects", projectName, "sessions");
}

// eslint 无此项目,仅为可读性:匹配 ANSI SGR 转义序列
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** 纯清洗,供单测:reasonix run 的 stdout → 发言正文 */
export function cleanReasonixStdout(stdout: string): string {
  const lines = stdout.replace(ANSI_RE, "").split("\n");
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (/^▎\s*thinking$/.test(t)) return false; // 折叠 thinking 标记行
    if (t.startsWith("· codegraph:")) return false; // 后台工具准备通知
    if (/^·\s*\d+\s*tok\s*·/.test(t)) return false; // 结尾 token 统计行
    return true;
  });
  return kept.join("\n").trim();
}

interface ReasonixMetrics {
  prompt_tokens?: number;
  completion_tokens?: number;
}

function listSessionFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
}

/**
 * 在 sessions 目录中定位本次运行新建的会话文件。
 * 只有窗口内恰好新增 1 个文件才能唯一归属本次调用 → 返回其绝对路径(可信,下轮走增量)。
 * 新增 0 个(未定位)或多个(并发同 cwd,差集混入他进程文件)都无法唯一归属 → 降级 @last;
 * runner 的 isTrustedRef 会把 @last 判为不可信 → 下轮全量新会话,不会误续他进程线程(#4)。
 */
export function captureSessionRef(sessionsDir: string, before: Set<string>): string {
  const created = listSessionFiles(sessionsDir).filter((f) => !before.has(f));
  if (created.length !== 1) {
    if (created.length > 1) {
      console.warn(
        `[reasonix] 运行窗口出现 ${created.length} 个新会话文件(疑似并发同 cwd),无法唯一归属,降级为全量新会话`,
      );
    }
    return REASONIX_LAST_SESSION;
  }
  return path.join(sessionsDir, created[0]!);
}

export const reasonixAdapter: ProviderAdapter = {
  name: "reasonix",
  capabilities: { codeAccess: "inherited" }, // 仅换 cwd,依赖 reasonix 默认档(未强制只读)

  detect: () => detectReasonix(),

  async speak({ prompt, sessionRef, model, cwd, timeoutMs }) {
    const { cmd, baseArgs } = await resolveReasonixCmd();
    const metricsFile = path.join(os.tmpdir(), `roundtable-reasonix-${crypto.randomUUID()}.json`);
    const args = [...baseArgs, "run", "--max-steps", "2", "--metrics", metricsFile];
    if (model) args.push("--model", model);
    if (sessionRef === REASONIX_LAST_SESSION) args.push("-c");
    else if (sessionRef) args.push("--resume", sessionRef);

    const sessionsDir = reasonixSessionsDir(cwd);
    const before = sessionRef ? undefined : new Set(listSessionFiles(sessionsDir));
    try {
      const { stdout } = await execProvider({
        provider: "reasonix",
        cmd,
        args,
        cwd,
        timeoutMs,
        stdin: prompt,
      });
      const text = cleanReasonixStdout(stdout);
      if (text === "") throw new Error("reasonix stdout 清洗后为空,未取得正文");
      let tokens: SpeakResult["tokens"];
      if (fs.existsSync(metricsFile)) {
        const metrics = JSON.parse(fs.readFileSync(metricsFile, "utf8")) as ReasonixMetrics;
        // metrics 无缓存拆分,cached 记 0(input 为总 prompt 量)
        tokens = { input: metrics.prompt_tokens ?? 0, cached: 0, output: metrics.completion_tokens ?? 0 };
      }
      return {
        text,
        sessionRef: before ? captureSessionRef(sessionsDir, before) : sessionRef!,
        tokens,
      };
    } finally {
      fs.rmSync(metricsFile, { force: true });
    }
  },
};
