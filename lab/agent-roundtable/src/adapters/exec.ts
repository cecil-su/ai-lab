import { spawn } from "node:child_process";
import treeKill from "tree-kill";

/** 杀掉以 pid 为根的整棵进程树(含 detached 孙进程)。tree-kill 按 ppid 递归,
 *  Windows 走 taskkill /T /F、POSIX 走进程树遍历。回调 err 吞掉(进程可能已退)。 */
function killTree(pid: number | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (pid === undefined) return resolve();
    treeKill(pid, "SIGKILL", () => resolve());
  });
}

export interface ExecOutput {
  stdout: string;
  stderr: string;
}

export class ProviderExecError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly detail: { exitCode?: number | null; timedOut?: boolean; overflow?: boolean; stderr?: string } = {},
  ) {
    const snippet = detail.stderr?.trim().slice(0, 400);
    super(`[${provider}] ${message}${snippet ? `\nstderr: ${snippet}` : ""}`);
    this.name = "ProviderExecError";
  }
}

/** provider 输出累积上限(字节):失控 provider 无界吐字会吃爆内存,超限即判失控杀进程 */
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** 统一子进程执行:prompt 经 stdin 传递(避免 Windows 引号/中文转义),超时/输出超限杀进程 */
export function execProvider(opts: {
  provider: string;
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  stdin?: string;
  maxOutputBytes?: number;
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
    const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let outBytes = 0;

    const timer = setTimeout(() => {
      timedOut = true;
      // 杀整树(含 detached 孙进程),而非仅直接子进程;整树退出后 'close' 触发再 reject
      void killTree(child.pid);
    }, opts.timeoutMs);

    // 流错误等失败路径:先杀整树再 reject,避免 detached 孙进程遗留继续耗 token/写仓库
    const fail = (err: ProviderExecError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void killTree(child.pid).finally(() => reject(err));
    };

    // 累计 stdout+stderr 字节;超上限判失控 → 杀整树 + overflow 错误,并停止继续累积(防 reject 前继续涨内存)
    const onChunk = (append: (c: string) => void) => (chunk: string) => {
      if (settled) return;
      outBytes += Buffer.byteLength(chunk, "utf8");
      if (outBytes > maxBytes) {
        fail(new ProviderExecError(opts.provider, `输出超上限(${maxBytes} 字节),疑似失控,已杀进程`, { overflow: true, stderr }));
        return;
      }
      append(chunk);
    };
    child.stdout.setEncoding("utf8").on("data", onChunk((c) => (stdout += c)));
    child.stderr.setEncoding("utf8").on("data", onChunk((c) => (stderr += c)));
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
