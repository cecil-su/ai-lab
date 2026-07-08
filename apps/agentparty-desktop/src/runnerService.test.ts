import { describe, expect, it, vi } from "vitest";
import { TauriRunnerService } from "./runnerService";
import type { LocalAgentConfig, RunnerContext } from "./types";

const config: LocalAgentConfig = {
  id: "agent-1",
  name: "bot",
  channelId: "chan-1",
  runnerKind: "fake",
  workdir: "D:\\Workspace\\agent",
  workdirMode: "read-only",
  sendingPolicy: "draft",
  createdAt: 1,
  updatedAt: 1,
};

const context = {
  triggeringMessage: { id: "msg-1", body: "please help" },
} as RunnerContext;

describe("TauriRunnerService", () => {
  it("dispatches fake configs to the fake runner command", async () => {
    const invoke = vi.fn().mockResolvedValue({ status: "done" });
    const service = new TauriRunnerService(invoke);

    await service.runRunner(config, context);

    expect(invoke).toHaveBeenCalledWith("run_fake_runner", { agentConfig: config, context });
  });

  it("dispatches codex configs to the codex runner command", async () => {
    const invoke = vi.fn().mockResolvedValue({ status: "done" });
    const service = new TauriRunnerService(invoke);
    const codexConfig = { ...config, runnerKind: "codex" as const };

    await service.runRunner(codexConfig, context);

    expect(invoke).toHaveBeenCalledWith("run_codex_runner", { agentConfig: codexConfig, context });
  });
});
