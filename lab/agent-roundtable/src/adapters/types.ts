export interface SpeakResult {
  text: string;
  sessionRef: string;
  tokens?: { input?: number; output?: number };
}

export interface SpeakOptions {
  prompt: string;
  /** 缺省 = 新会话 */
  sessionRef?: string;
  model?: string;
  /** 话题目录,隔离各 CLI 的仓库上下文注入 */
  cwd: string;
  timeoutMs: number;
}

export interface ProviderAdapter {
  name: string;
  detect(): Promise<{ ok: boolean; version?: string }>;
  speak(opts: SpeakOptions): Promise<SpeakResult>;
}
