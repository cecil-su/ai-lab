/**
 * 结构化会话引用(ADR 0032):取代裸 string。一个 string 曾同时表达 6 种含义
 * (各家 id / reasonix 文件路径 / @last 哨兵 / mock 计数),且不携带归属与信任。
 * 现在归属(provider)与信任(trust/resumable)在"捕获时刻"确定,不再散在 runner/finalizer 里重推。
 */
export interface SessionRef {
  provider: string; // provider base:claude/codex/opencode/reasonix/mock
  value: string; // 原生 id / 文件路径 / 计数
  trust: "verified" | "degraded";
  resumable: boolean; // 是否允许 --resume/-c 走增量
}

// reasonix 降级会话在旧 topic.json(v1)里存的裸哨兵,仅用于迁移识别(ADR 0032)。
export const LEGACY_DEGRADED_SENTINEL = "@last";

/** 可信、可续接:provider 已从输出唯一解析到 id/路径。SessionRef 的构造与类型同处 adapters 层。 */
export function makeVerified(provider: string, value: string): SessionRef {
  return { provider, value, trust: "verified", resumable: true };
}

/** 降级:无法唯一归属本次调用(如 reasonix 目录 diff 歧义),不得走增量 → 下轮全量新会话。 */
export function makeDegraded(provider: string, value = LEGACY_DEGRADED_SENTINEL): SessionRef {
  return { provider, value, trust: "degraded", resumable: false };
}

export interface SpeakResult {
  text: string;
  sessionRef: SessionRef;
  // input = 本次新处理(全额计费)的 prompt token;cached = 缓存读(廉价复用);output = 生成
  tokens?: { input?: number; cached?: number; output?: number };
}

export interface SpeakOptions {
  prompt: string;
  /** 缺省 = 新会话;仅当可信可续(canResume)时由 runner 传入 */
  sessionRef?: SessionRef;
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
