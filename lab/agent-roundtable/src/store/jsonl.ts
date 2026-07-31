import fs from "node:fs";

const RENAME_RETRY_MS = 50;
const RENAME_MAX_ATTEMPTS = 5;

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Windows 上 rename 覆盖已存在目标会因瞬态句柄/杀软扫描抛 EPERM/EBUSY/EACCES;
 * 短退避重试,避免单次瞬态错误杀掉整个 runner。
 */
export function renameWithRetry(tmp: string, target: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!transient || attempt >= RENAME_MAX_ATTEMPTS) throw err;
      sleepMs(RENAME_RETRY_MS * attempt);
    }
  }
}

export interface JsonlRead<T> {
  entries: T[];
  /** 坏行(字节交错/半行合并)的物理行号:容错跳过,不因单条坏行拖垮恢复 */
  badLines: number[];
}

/**
 * 容错读:坏行跳过并计入 badLines(与 inbox A2 同一策略)。
 * 崩溃中途写出的半行被 appendJsonl 的换行护栏隔离后,会以坏行形式出现在中间。
 */
export function readJsonl<T>(file: string): JsonlRead<T> {
  const empty: JsonlRead<T> = { entries: [], badLines: [] };
  if (!fs.existsSync(file)) return empty;
  const segments = fs.readFileSync(file, "utf8").split("\n");
  segments.pop(); // 末尾半行(正常为 "",异常为他进程写入中的半行)丢弃
  const entries: T[] = [];
  const badLines: number[] = [];
  let line = 0;
  for (const seg of segments) {
    if (seg.trim() === "") continue; // 空段不计行(appendJsonl 不产空行)
    line += 1;
    try {
      entries.push(JSON.parse(seg) as T);
    } catch {
      badLines.push(line);
    }
  }
  return { entries, badLines };
}

export function appendJsonl(file: string, value: unknown): void {
  // 换行护栏:崩溃留下的末尾半行(无 \n)若直接拼接下一条 JSON 会合并成一行坏数据;
  // 先补一个 \n 把半行隔离为独立坏行(容错跳过),新事件始终从新行开始。
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(1);
      fs.readSync(fd, buf, 0, 1, fs.statSync(file).size - 1);
      if (buf[0] !== 0x0a) fs.appendFileSync(file, "\n");
    } finally {
      fs.closeSync(fd);
    }
  }
  fs.appendFileSync(file, JSON.stringify(value) + "\n");
}

export function writeJsonAtomic(file: string, value: unknown): void {
  // 唯一 tmp 名(pid+时间):固定 .tmp 会与残留/并发写者冲突,也是 Windows EPERM 的常见来源
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  try {
    renameWithRetry(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true }); // 失败不残留 tmp
    throw err;
  }
}
