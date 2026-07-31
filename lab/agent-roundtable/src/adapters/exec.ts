import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import treeKill from "tree-kill";

/** provider 优雅退出宽限:SIGTERM 后等这么久仍未退 → SIGKILL 强杀 */
const KILL_GRACE_MS = 3000;
const KILL_CONFIRM_MS = 1000;
const KILL_POLL_MS = 50;
const PROCESS_QUERY_TIMEOUT_MS = 500;
const WINDOWS_TASKKILL_TIMEOUT_MS = 5000;

interface ProcessInfo {
  pid: number;
  ppid: number;
  /** 进程启动身份:Linux 用 /proc starttime tick,其他 POSIX 用 ps lstart */
  startedAt: string;
}

function readProcessTable(timeoutMs = PROCESS_QUERY_TIMEOUT_MS): Promise<Map<number, ProcessInfo>> {
  const args = process.platform === "linux"
    ? ["-eo", "pid=,ppid=,lstart="]
    : ["-axo", "pid=,ppid=,lstart="];
  return new Promise((resolve, reject) => {
    execFile(
      "ps",
      args,
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: Math.max(1, timeoutMs) },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const table = new Map<number, ProcessInfo>();
        for (const line of String(stdout).split(/\r?\n/)) {
          const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
          if (!match) continue;
          const info: ProcessInfo = { pid: Number(match[1]), ppid: Number(match[2]), startedAt: match[3]! };
          table.set(info.pid, info);
        }
        resolve(table);
      },
    );
  });
}

/** Linux 用 /proc starttime tick 作高精度身份;其他 POSIX 退化为 ps lstart。 */
function processIdentity(info: ProcessInfo): string {
  if (process.platform !== "linux") return `ps:${info.startedAt}`;
  try {
    const stat = fs.readFileSync(`/proc/${info.pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return `ps:${info.startedAt}`;
    // ')' 后从字段 3(state)起算;字段 22(starttime)为下标 19。
    const startTicks = stat.slice(closeParen + 2).trim().split(/\s+/)[19];
    return startTicks ? `proc:${startTicks}` : `ps:${info.startedAt}`;
  } catch {
    return `ps:${info.startedAt}`;
  }
}

function collectInitialTree(table: Map<number, ProcessInfo>, rootPid: number): Map<number, ProcessInfo> {
  const root = table.get(rootPid);
  if (!root) return new Map();
  const owned = new Map<number, ProcessInfo>([[rootPid, root]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const info of table.values()) {
      if (!owned.has(info.pid) && owned.has(info.ppid)) {
        owned.set(info.pid, info);
        changed = true;
      }
    }
  }
  for (const [pid, info] of owned) owned.set(pid, { ...info, startedAt: processIdentity(info) });
  return owned;
}

/**
 * 按首次捕获的 pid+启动身份重新确认归属,再纳入仍存活成员后来创建的后代。
 * 即使根进程已退出、detached 子进程被 reparent,也能凭首次身份继续追踪;
 * PID 若被复用则启动身份不同,不会把新进程当作原后代。
 */
async function refreshOwned(
  identities: Map<number, string>,
  queryTimeoutMs = PROCESS_QUERY_TIMEOUT_MS,
): Promise<Map<number, ProcessInfo>> {
  const table = await readProcessTable(queryTimeoutMs);
  const owned = new Map<number, ProcessInfo>();
  for (const [pid, startedAt] of identities) {
    const current = table.get(pid);
    if (current && processIdentity(current) === startedAt) {
      owned.set(pid, { ...current, startedAt });
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const info of table.values()) {
      if (!owned.has(info.pid) && owned.has(info.ppid)) {
        const identity = processIdentity(info);
        owned.set(info.pid, { ...info, startedAt: identity });
        identities.set(info.pid, identity);
        changed = true;
      }
    }
  }
  return owned;
}

function signalOwned(owned: Map<number, ProcessInfo>, rootPid: number, signal: NodeJS.Signals): void {
  // 先后代、后根:尽量先通知整树,再让根退出;PID 身份已在 signal 前确认。
  const pids = [...owned.keys()].filter((p) => p !== rootPid);
  if (owned.has(rootPid)) pids.push(rootPid);
  for (const pid of pids) signalPid(pid, signal);
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
      // EPERM/平台瞬态交给后续 SIGKILL/确认阶段;终止流程自身不得把调用方永挂住。
    }
  }
}

/** ps 后续查询失败时也不能丢掉已捕获后代。Linux 先用 /proc 高精度身份复核;其他 POSIX best-effort。 */
function forceCaptured(identities: Map<number, string>): void {
  for (const [pid, expected] of identities) {
    if (process.platform === "linux") {
      const current = processIdentity({ pid, ppid: 0, startedAt: "" });
      if (current !== expected) continue;
    }
    signalPid(pid, "SIGKILL");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilGone(identities: Map<number, string>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    const remainingBeforeQuery = deadline - Date.now();
    const queryTimeout = Math.min(PROCESS_QUERY_TIMEOUT_MS, Math.max(1, remainingBeforeQuery));
    if ((await refreshOwned(identities, queryTimeout)).size === 0) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(KILL_POLL_MS, remaining));
  }
}

function treeKillWindows(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // 不经 shell;taskkill /T /F 是 Windows 上的即时整树强杀。
    execFile(
      "taskkill",
      ["/pid", String(pid), "/T", "/F"],
      { timeout: WINDOWS_TASKKILL_TIMEOUT_MS, windowsHide: true },
      (err) => {
        if (!err) {
          resolve();
          return;
        }
        // 根已退出时 taskkill 常返回非零,此时视作幂等完成;根仍活则不能伪称整树清理成功。
        try {
          process.kill(pid, 0);
          reject(err);
        } catch (probeErr) {
          if ((probeErr as NodeJS.ErrnoException).code === "ESRCH") resolve();
          else reject(err);
        }
      },
    );
  });
}

/** ps/身份追踪异常时的有界强杀兜底;回调或 deadline 任一到达即结束清理。 */
function boundedTreeKill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, KILL_CONFIRM_MS);
    try {
      treeKill(pid, "SIGKILL", finish);
    } catch {
      finish();
    }
  });
}

/**
 * 终止以 pid 为根的整棵进程树。POSIX 首次快照会保留 detached 后代身份:
 * 先给全树 SIGTERM;宽限后重新确认同一批 pid+启动身份并吸收其新后代,再 SIGKILL。
 * Promise 只在整树退出或有界强杀确认结束后 resolve,失败路径不会在 TERM 刚发出时提前 settle。
 * Windows 直接使用带 timeout 的 taskkill /T /F,故仍是即时强杀。
 */
async function killTree(pid: number | undefined, graceMs = KILL_GRACE_MS): Promise<void> {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    await treeKillWindows(pid);
    return;
  }

  const identities = new Map<number, string>();
  try {
    const initial = collectInitialTree(await readProcessTable(), pid);
    if (initial.size === 0) {
      // 不能把 ps 空结果当成成功证明;用有界 tree-kill 再确认性清理一次。
      await boundedTreeKill(pid);
      return;
    }
    for (const [ownedPid, info] of initial) identities.set(ownedPid, info.startedAt);
    signalOwned(initial, pid, "SIGTERM");
    if (await waitUntilGone(identities, graceMs)) return;

    const survivors = await refreshOwned(identities);
    signalOwned(survivors, pid, "SIGKILL");
    if (!(await waitUntilGone(identities, KILL_CONFIRM_MS))) forceCaptured(identities);
  } catch {
    // ps 失败/超时不得丢掉已捕获且可能已 reparent 的后代;先按身份强杀快照,再尝试 root tree fallback。
    forceCaptured(identities);
    await boundedTreeKill(pid);
  }
}

export interface ExecOutput {
  stdout: string;
  stderr: string;
}

export class ProviderExecError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly detail: {
      exitCode?: number | null;
      timedOut?: boolean;
      overflow?: boolean;
      cleanupFailed?: boolean;
      stderr?: string;
    } = {},
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
  /** 测试可缩短 SIGTERM→SIGKILL 宽限;生产用默认 */
  killGraceMs?: number;
}): Promise<ExecOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.cmd, opts.args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let outBytes = 0;

    // timeout / overflow / 流错误统一走 fail:先完成有界整树终止,再向调用方 reject。
    // settled 在清理开始时即关闭输出累积与 close 二次结算。
    let timer: NodeJS.Timeout;
    const fail = (err: ProviderExecError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void killTree(child.pid, opts.killGraceMs).then(
        () => reject(err),
        (cleanupErr: unknown) => {
          err.detail.cleanupFailed = true;
          err.message += `\n进程树清理未确认:${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`;
          reject(err);
        },
      );
    };
    timer = setTimeout(() => {
      fail(
        new ProviderExecError(opts.provider, `超时(${opts.timeoutMs}ms)`, {
          timedOut: true,
          stderr,
        }),
      );
    }, opts.timeoutMs);

    // 累计 stdout+stderr 字节;超上限判失控 → 杀整树 + overflow 错误,并停止继续累积(防 reject 前继续涨内存)
    const onChunk = (append: (c: string) => void) => (chunk: string) => {
      if (settled) return;
      outBytes += Buffer.byteLength(chunk, "utf8");
      if (outBytes > maxBytes) {
        fail(new ProviderExecError(opts.provider, `输出超上限(${maxBytes} 字节),疑似失控`, { overflow: true, stderr }));
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
      if (code !== 0) {
        reject(new ProviderExecError(opts.provider, `退出码 ${code}`, { exitCode: code, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
