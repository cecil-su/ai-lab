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

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  // appendJsonl 总以 \n 收尾;末段若非空是他进程写入中的半行,丢弃留待下次读取
  lines.pop();
  return lines.filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as T);
}

export function appendJsonl(file: string, value: unknown): void {
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
