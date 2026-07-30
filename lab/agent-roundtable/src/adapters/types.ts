export interface SpeakResult {
  text: string;
  sessionRef: string;
  // input = 本次新处理(全额计费)的 prompt token;cached = 缓存读(廉价复用);output = 生成
  tokens?: { input?: number; cached?: number; output?: number };
}

export interface SpeakOptions {
  prompt: string;
  /** 缺省 = 新会话 */
  sessionRef?: string;
  model?: string;
  /** 子进程工作目录:自读时为代码仓库,否则为话题目录 */
  cwd: string;
  /** 自读(R2):cwd 为代码仓库时置 true,各家开只读文件访问;缺省禁工具/默认档 */
  codeAccess?: boolean;
  timeoutMs: number;
}

export interface ProviderAdapter {
  name: string;
  detect(): Promise<{ ok: boolean; version?: string }>;
  speak(opts: SpeakOptions): Promise<SpeakResult>;
  /**
   * 能力声明(A4):codeAccess 的只读语义各家不同——
   * enforced = 由 flag 强制只读(claude plan / codex -s read-only);
   * inherited = 仅换 cwd,依赖该 CLI 自身默认(opencode/reasonix/mock,未强制)。
   * 用于 --repo 时点名不强制只读的 provider;硬截止线:--repo 转正/v2 前须对 inherited 默认拒绝。
   */
  capabilities?: { codeAccess: "enforced" | "inherited" };
}
