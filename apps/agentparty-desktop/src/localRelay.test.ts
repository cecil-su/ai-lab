import { beforeEach, describe, expect, it } from "vitest";
import { LocalRelay, buildRunnerContext } from "./localRelay";
import type { ChannelEvent, ChannelMessage, LocalAgentConfig, RunnerContext, ServerProfile, StatusUpdate, TokenMetadata } from "./types";
import type { ChannelSubscription, ProtocolClient } from "./protocolClient";
import { MemoryRunnerService, type RunnerService } from "./runnerService";
import { MemoryPendingQueueStore } from "./pendingQueueStore";

const human: TokenMetadata = {
  id: "tok-human",
  kind: "human",
  owner_label: "Ada",
  created_at: 1,
  revoked_at: null,
};

const agentSender: TokenMetadata = {
  ...human,
  id: "tok-agent",
  owner_label: "bot",
};

const profile: ServerProfile = {
  id: "profile-1",
  name: "Local",
  serverUrl: "http://127.0.0.1:4180",
  channelId: "chan-1",
  createdAt: 1,
  updatedAt: 1,
};

const config: LocalAgentConfig = {
  id: "agent-1",
  name: "bot",
  channelId: "chan-1",
  runnerKind: "fake",
  workdir: "D:\\Workspace\\agent",
  sendingPolicy: "draft",
  createdAt: 1,
  updatedAt: 1,
};

function message(sequence: number, body: string, mentions: string[] = ["bot"], sender = human, replyTo: string | null = null): ChannelMessage {
  return {
    id: `msg-${sequence}`,
    channel_id: "chan-1",
    sequence,
    sender,
    body,
    mentions,
    reply_to_message_id: replyTo,
    created_at: sequence,
  };
}

class FakeProtocolClient implements ProtocolClient {
  statuses: string[] = [];
  posts: { body: string; replyTo: string | null }[] = [];
  watcher: ((event: ChannelEvent) => void) | null = null;

  async loadHistory() {
    return { events: [], last_sequence: 0 };
  }

  async postMessage(_profile: ServerProfile, _token: string, request: { body: string; reply_to_message_id: string | null }) {
    this.posts.push({ body: request.body, replyTo: request.reply_to_message_id });
    return message(99, request.body, [], agentSender, request.reply_to_message_id);
  }

  async postStatus(_profile: ServerProfile, _token: string, request: { state: string }): Promise<StatusUpdate> {
    this.statuses.push(request.state);
    return {
      channel_id: "chan-1",
      sequence: this.statuses.length,
      participant: human,
      state: request.state as StatusUpdate["state"],
      created_at: this.statuses.length,
    };
  }

  watchChannel(_profile: ServerProfile, _token: string, onEvent: (event: ChannelEvent) => void): ChannelSubscription {
    this.watcher = onEvent;
    return { close: () => undefined };
  }
}

describe("LocalRelay", () => {
  let protocol: FakeProtocolClient;
  let runner: MemoryRunnerService;
  let pendingQueue: MemoryPendingQueueStore;
  let relay: LocalRelay;

  beforeEach(() => {
    protocol = new FakeProtocolClient();
    runner = new MemoryRunnerService();
    pendingQueue = new MemoryPendingQueueStore();
    relay = new LocalRelay(protocol, runner, pendingQueue);
  });

  it("advertises waiting on start and done on stop", async () => {
    await relay.start({ profile, token: "token", config, recentMessages: [], lastSequence: 0 });
    await relay.stop();

    expect(protocol.statuses).toEqual(["waiting", "done"]);
  });

  it("routes fresh mentioned messages to the fake runner", async () => {
    await relay.start({ profile, token: "token", config, recentMessages: [], lastSequence: 1 });
    await relay.handleEvent({ type: "Message", payload: message(2, "please help") });

    expect(runner.logs).toHaveLength(1);
    expect(runner.logs[0]?.draftReply).toContain("please help");
    expect(relay.getSnapshot().processedMessageIds).toEqual(["msg-2"]);
  });

  it("routes codex configs to the codex runner", async () => {
    await relay.start({
      profile,
      token: "token",
      config: { ...config, runnerKind: "codex" },
      recentMessages: [],
      lastSequence: 1,
    });
    await relay.handleEvent({ type: "Message", payload: message(2, "please help") });

    expect(runner.logs).toHaveLength(1);
    expect(runner.logs[0]?.stdout).toContain("codex runner handled msg-2");
    await expect(pendingQueue.listPendingDrafts()).resolves.toEqual([
      expect.objectContaining({
        status: "pending",
        body: expect.stringContaining("Codex runner bot"),
      }),
    ]);
  });

  it("creates pending draft replies from successful fake runner results by default", async () => {
    await relay.start({ profile, token: "token", config, recentMessages: [], lastSequence: 1 });
    await relay.handleEvent({ type: "Message", payload: message(2, "please help") });

    await expect(pendingQueue.listPendingDrafts()).resolves.toEqual([
      expect.objectContaining({
        agentConfigId: "agent-1",
        triggeringMessageId: "msg-2",
        body: expect.stringContaining("please help"),
        status: "pending",
      }),
    ]);
  });

  it("auto-sends runner results when configured and bypasses the pending queue", async () => {
    await relay.start({
      profile,
      token: "token",
      config: { ...config, sendingPolicy: "auto-send" },
      recentMessages: [],
      lastSequence: 1,
    });
    await relay.handleEvent({ type: "Message", payload: message(2, "please help") });

    expect(protocol.posts).toEqual([{ body: "Fake runner bot saw: please help", replyTo: "msg-2" }]);
    await expect(pendingQueue.listPendingDrafts()).resolves.toEqual([]);
  });

  it("creates blocked pending items when the runner fails", async () => {
    const failingRunner: RunnerService = {
      listRunnerLogs: async () => [],
      runRunner: async () => {
        throw new Error("runner failed");
      },
    };
    relay = new LocalRelay(protocol, failingRunner, pendingQueue);

    await relay.start({ profile, token: "token", config, recentMessages: [], lastSequence: 1 });
    await relay.handleEvent({ type: "Message", payload: message(2, "please help") });

    await expect(pendingQueue.listPendingDrafts()).resolves.toEqual([
      expect.objectContaining({
        triggeringMessageId: "msg-2",
        status: "blocked",
        error: "runner failed",
      }),
    ]);
  });

  it("refuses to start a config bound to another channel", async () => {
    await expect(
      relay.start({
        profile,
        token: "token",
        config: { ...config, channelId: "other-channel" },
        recentMessages: [],
        lastSequence: 0,
      }),
    ).rejects.toThrow("bound to a different channel");
  });

  it("ignores self messages, replayed messages, and non-mentioned messages", async () => {
    await relay.start({ profile, token: "token", config, recentMessages: [], lastSequence: 3 });
    await relay.handleEvent({ type: "Message", payload: message(2, "old") });
    await relay.handleEvent({ type: "Message", payload: message(4, "self", ["bot"], agentSender) });
    await relay.handleEvent({ type: "Message", payload: message(5, "not for bot", []) });

    expect(runner.logs).toHaveLength(0);
  });

  it("builds runner context with reply target, recent messages, mentions, and protocol reminder", () => {
    const parent = message(1, "parent", []);
    const trigger = message(2, "child", ["bot"], human, "msg-1");

    const context: RunnerContext = buildRunnerContext(config, trigger, [parent, trigger]);

    expect(context.channel.id).toBe("chan-1");
    expect(context.triggeringMessage.id).toBe("msg-2");
    expect(context.sender.owner_label).toBe("Ada");
    expect(context.replyTarget?.id).toBe("msg-1");
    expect(context.mentions).toEqual(["bot"]);
    expect(context.recentMessages.map((item) => item.id)).toEqual(["msg-1"]);
    expect(context.protocolReminder).toContain("Do not post directly");
  });
});
