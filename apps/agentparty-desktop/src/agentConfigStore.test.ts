import { describe, expect, it, vi } from "vitest";
import { MemoryAgentConfigStore, toPersistedAgentConfig } from "./agentConfigStore";

describe("agent config persistence", () => {
  it("creates local fake-runner agent configs with channel binding and sending policy", () => {
    const config = toPersistedAgentConfig(
      {
        name: "bot",
        channelId: "chan-1",
        runnerKind: "fake",
        workdir: "D:\\Workspace\\agent",
        sendingPolicy: "draft",
      },
      1000,
    );

    expect(config).toEqual({
      id: expect.any(String),
      name: "bot",
      channelId: "chan-1",
      runnerKind: "fake",
      workdir: "D:\\Workspace\\agent",
      sendingPolicy: "draft",
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it("lists saved configs without changing their created time on update", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const store = new MemoryAgentConfigStore();
    const saved = await store.saveAgentConfig({
      name: "bot",
      channelId: "chan-1",
      runnerKind: "fake",
      workdir: "D:\\Workspace\\agent",
      sendingPolicy: "draft",
    });
    await store.saveAgentConfig({ ...saved, workdir: "D:\\Workspace\\agent-2" });

    await expect(store.listAgentConfigs()).resolves.toEqual([
      expect.objectContaining({
        id: saved.id,
        createdAt: 1000,
        updatedAt: 2000,
        workdir: "D:\\Workspace\\agent-2",
      }),
    ]);
  });
});
