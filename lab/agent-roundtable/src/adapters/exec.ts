import { spawn } from "node:child_process";

export interface ExecOutput {
  stdout: string;
  stderr: string;
}

export class ProviderExecError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly detail: { exitCode?: number | null; timedOut?: boolean; stderr?: string } = {},
  ) {
    const snippet = detail.stderr?.trim().slice(0, 400);
    super(`[${provider}] ${message}${snippet ? `\nstderr: ${snippet}` : ""}`);
    this.name = "ProviderExecError";
  }
}

/** 统一子进程执行:prompt 经 stdin 传递(避免 Windows 引号/中文转义),超时杀进程 */
export function execProvider(opts: {
  provider: string;
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  stdin?: string;
}): Promise<ExecOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.cmd, opts.args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);

    const fail = (err: ProviderExecError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    // stdio 流级 'error'(如 Windows spawn 时 socket read ENOTCONN)必须监听,
    // 否则会作为 unhandled 'error' 事件炸掉整个进程、绕过上层 F1 的 try/catch。
    // stdout 是必要输出,其流错误按启动失败处理;stderr/stdin 非关键,吞掉。
    child.stdout.on("error", (err) => fail(new ProviderExecError(opts.provider, `stdout 流错误: ${err.message}`, { stderr })));
    child.stderr.on("error", () => {});
    // 子进程提前退出时 stdin 写入会 EPIPE,吞掉即可
    child.stdin.on("error", () => {});
    if (opts.stdin !== undefined) child.stdin.write(opts.stdin, "utf8");
    child.stdin.end();

    child.on("error", (err) => {
      fail(new ProviderExecError(opts.provider, `无法启动 ${opts.cmd}: ${err.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new ProviderExecError(opts.provider, `超时(${opts.timeoutMs}ms),已杀进程`, {
            timedOut: true,
            stderr,
          }),
        );
      } else if (code !== 0) {
        reject(new ProviderExecError(opts.provider, `退出码 ${code}`, { exitCode: code, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
