import { describe, expect, it, vi } from "vitest";
import { findWritableWorkdirConflict, MemoryAgentConfigStore, toPersistedAgentConfig } from "./agentConfigStore";

describe("agent config persistence", () => {
  it("creates local fake-runner agent configs with channel binding and sending policy", () => {
    const config = toPersistedAgentConfig(
      {
        name: "bot",
        channelId: "chan-1",
        runnerKind: "fake",
        workdir: "D:\\Workspace\\agent",
        workdirMode: "read-only",
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
      workdirMode: "read-only",
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
      workdirMode: "read-only",
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

  it("allows multiple read-only agents to share a workdir", () => {
    const first = toPersistedAgentConfig({
      name: "reader-a",
      channelId: "chan-1",
      runnerKind: "fake",
      workdir: "D:\\Workspace\\shared",
      workdirMode: "read-only",
      sendingPolicy: "draft",
    }, 1000);
    const second = toPersistedAgentConfig({
      name: "reader-b",
      channelId: "chan-1",
      runnerKind: "codex",
      workdir: "D:\\Workspace\\shared\\",
      workdirMode: "read-only",
      sendingPolicy: "draft",
    }, 1000);

    expect(findWritableWorkdirConflict(second, [first])).toBeNull();
  });

  it("detects writable agents sharing the same workdir", () => {
    const first = toPersistedAgentConfig({
      name: "writer-a",
      channelId: "chan-1",
      runnerKind: "fake",
      workdir: "D:\\Workspace\\shared",
      workdirMode: "writable",
      sendingPolicy: "draft",
    }, 1000);
    const second = toPersistedAgentConfig({
      name: "writer-b",
      channelId: "chan-1",
      runnerKind: "codex",
      workdir: "d:\\workspace\\shared\\",
      workdirMode: "writable",
      sendingPolicy: "draft",
    }, 1000);

    expect(findWritableWorkdirConflict(second, [first])?.name).toBe("writer-a");
  });
});
