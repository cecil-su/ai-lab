import type { LocalAgentConfig, RunnerContext, RunnerLogEntry, RunnerResult } from "./types";

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface RunnerService {
  runFakeRunner(agentConfig: LocalAgentConfig, context: RunnerContext): Promise<RunnerResult>;
  listRunnerLogs(): Promise<RunnerLogEntry[]>;
}

export class TauriRunnerService implements RunnerService {
  private readonly invoke: TauriInvoke;

  constructor(invoke = window.__TAURI__?.core?.invoke) {
    if (!invoke) throw new Error("Tauri invoke API is unavailable");
    this.invoke = invoke;
  }

  runFakeRunner(agentConfig: LocalAgentConfig, context: RunnerContext): Promise<RunnerResult> {
    return this.invoke("run_fake_runner", { agentConfig, context });
  }

  listRunnerLogs(): Promise<RunnerLogEntry[]> {
    return this.invoke("list_runner_logs");
  }
}

export class MemoryRunnerService implements RunnerService {
  logs: RunnerLogEntry[] = [];

  async runFakeRunner(agentConfig: LocalAgentConfig, context: RunnerContext): Promise<RunnerResult> {
    const result: RunnerResult = {
      status: "done",
      draftReply: `Fake runner ${agentConfig.name} saw: ${context.triggeringMessage.body}`,
      stdout: `fake runner handled ${context.triggeringMessage.id}`,
      stderr: "",
      exitCode: 0,
      contextFilePath: `${agentConfig.workdir.replace(/\\+$/, "")}\\runner-context-${context.triggeringMessage.id}.json`,
    };
    this.logs.push({
      ...result,
      id: `log-${this.logs.length + 1}`,
      agentConfigId: agentConfig.id,
      triggeringMessageId: context.triggeringMessage.id,
      createdAt: Date.now(),
    });
    return result;
  }

  async listRunnerLogs(): Promise<RunnerLogEntry[]> {
    return [...this.logs];
  }
}
