import fs from "node:fs";
import path from "node:path";

// 注入(R1):把 --context-file / --context-dir 指定的文件读成 charter 的「## 参考材料」段。
// 所有参与者(含被禁工具的 claude)经 charter 都能读到;体积超限只告警不阻断。

export const CONTEXT_MAX_BYTES = 200_000;

export interface ContextInput {
  /** --context-file 的 csv 展开;相对路径按 cwd 解析 */
  files: string[];
  /** --context-dir(非递归) */
  dir?: string;
  /** --context-glob:*.ext / 前缀* / 子串,仅配合 --context-dir */
  glob?: string;
  /** 相对路径解析与展示基准 */
  cwd: string;
}

export interface ContextEntry {
  /** 展示用:cwd 内取相对路径,否则取文件名 */
  label: string;
  bytes: number;
}

export interface ContextResult {
  /** 「## 参考材料」段正文;无材料时为 "" */
  material: string;
  entries: ContextEntry[];
  totalBytes: number;
  overLimit: boolean;
}

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".md": "markdown",
  ".json": "json",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".sh": "bash",
  ".yml": "yaml",
  ".yaml": "yaml",
};

/** 极简 glob:含 * 转锚定正则(其余字符转义),否则按文件名子串匹配 */
function matchGlob(name: string, glob: string): boolean {
  if (!glob.includes("*")) return name.includes(glob);
  const re = new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return re.test(name);
}

function labelFor(cwd: string, file: string): string {
  const rel = path.relative(cwd, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : path.basename(file);
}

/** 收集待注入文件绝对路径(--context-file 逐个校验存在;--context-dir 非递归 + 可选 glob) */
function collectFiles(input: ContextInput): string[] {
  const out: string[] = [];
  for (const f of input.files) {
    const abs = path.resolve(input.cwd, f);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error(`--context-file 路径不存在或不是文件: ${f}`);
    }
    out.push(abs);
  }
  if (input.dir) {
    const absDir = path.resolve(input.cwd, input.dir);
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
      throw new Error(`--context-dir 不存在或不是目录: ${input.dir}`);
    }
    for (const name of fs.readdirSync(absDir).sort()) {
      const abs = path.join(absDir, name);
      if (!fs.statSync(abs).isFile()) continue;
      if (input.glob && !matchGlob(name, input.glob)) continue;
      out.push(abs);
    }
  }
  return out;
}

/** 读取并组装参考材料段;无输入返回空 material */
export function buildContextMaterial(input: ContextInput): ContextResult {
  const files = collectFiles(input);
  if (files.length === 0) {
    return { material: "", entries: [], totalBytes: 0, overLimit: false };
  }
  const entries: ContextEntry[] = [];
  const blocks: string[] = [];
  let totalBytes = 0;
  for (const abs of files) {
    const content = fs.readFileSync(abs, "utf8");
    const bytes = Buffer.byteLength(content, "utf8");
    totalBytes += bytes;
    const label = labelFor(input.cwd, abs);
    entries.push({ label, bytes });
    const lang = LANG_BY_EXT[path.extname(abs).toLowerCase()] ?? "";
    blocks.push(`### ${label}\n\`\`\`${lang}\n${content.replace(/\s+$/, "")}\n\`\`\``);
  }
  const material = [
    "## 参考材料",
    "> 以下为被评审材料,供讨论引用(只读)。",
    blocks.join("\n\n"),
  ].join("\n\n");
  return { material, entries, totalBytes, overLimit: totalBytes > CONTEXT_MAX_BYTES };
}
