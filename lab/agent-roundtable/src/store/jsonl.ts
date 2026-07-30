import fs from "node:fs";

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
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}
