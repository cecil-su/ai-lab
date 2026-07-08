import type { LocalAgentConfig, LocalAgentConfigInput } from "./types";

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface AgentConfigStore {
  listAgentConfigs(): Promise<LocalAgentConfig[]>;
  saveAgentConfig(input: LocalAgentConfigInput): Promise<LocalAgentConfig>;
}

export function toPersistedAgentConfig(input: LocalAgentConfigInput, now = Date.now()): LocalAgentConfig {
  return {
    id: input.id?.trim() || crypto.randomUUID(),
    name: input.name.trim(),
    channelId: input.channelId.trim(),
    runnerKind: input.runnerKind,
    workdir: input.workdir.trim(),
    workdirMode: input.workdirMode,
    sendingPolicy: input.sendingPolicy,
    createdAt: now,
    updatedAt: now,
  };
}

export function findWritableWorkdirConflict(
  config: LocalAgentConfig,
  configs: LocalAgentConfig[],
): LocalAgentConfig | null {
  if (config.workdirMode !== "writable") return null;
  const normalized = normalizeWorkdir(config.workdir);
  return configs.find((item) =>
    item.id !== config.id &&
    item.workdirMode === "writable" &&
    normalizeWorkdir(item.workdir) === normalized
  ) ?? null;
}

function normalizeWorkdir(workdir: string): string {
  return workdir.trim().replace(/[\\/]+$/, "").toLowerCase();
}

export class TauriAgentConfigStore implements AgentConfigStore {
  private readonly invoke: TauriInvoke;

  constructor(invoke = window.__TAURI__?.core?.invoke) {
    if (!invoke) throw new Error("Tauri invoke API is unavailable");
    this.invoke = invoke;
  }

  listAgentConfigs(): Promise<LocalAgentConfig[]> {
    return this.invoke("list_local_agent_configs");
  }

  saveAgentConfig(input: LocalAgentConfigInput): Promise<LocalAgentConfig> {
    return this.invoke("save_local_agent_config", { input });
  }
}

export class MemoryAgentConfigStore implements AgentConfigStore {
  private configs = new Map<string, LocalAgentConfig>();

  async listAgentConfigs(): Promise<LocalAgentConfig[]> {
    return [...this.configs.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async saveAgentConfig(input: LocalAgentConfigInput): Promise<LocalAgentConfig> {
    const previous = input.id ? this.configs.get(input.id) : undefined;
    const now = Date.now();
    const config = {
      ...toPersistedAgentConfig(input, previous?.createdAt ?? now),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.configs.set(config.id, config);
    return config;
  }
}
