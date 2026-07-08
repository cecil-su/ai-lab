import { describe, expect, it, vi } from "vitest";
import { PendingQueue } from "./pendingQueue";
import { MemoryPendingQueueStore } from "./pendingQueueStore";
import { MemoryProfileStore } from "./profileStore";
import type { ProtocolClient, ChannelSubscription } from "./protocolClient";
import type { ChannelMessage, PendingDraftInput, ServerProfile, StatusUpdate, TokenMetadata } from "./types";

const sender: TokenMetadata = {
  id: "tok-agent",
  kind: "agent",
  owner_label: "bot",
  created_at: 1,
  revoked_at: null,
};

const input: PendingDraftInput = {
  profileId: "profile-1",
  serverUrl: "http://127.0.0.1:4180",
  channelId: "chan-1",
  agentConfigId: "agent-1",
  agentName: "bot",
  triggeringMessageId: "msg-1",
  body: "draft body",
  status: "pending",
  error: null,
  runnerResult: null,
};

class FakeProtocolClient implements ProtocolClient {
  posts: { body: string; replyTo: string | null; token: string }[] = [];

  async loadHistory() {
    return { events: [], last_sequence: 0 };
  }

  async postMessage(_profile: ServerProfile, token: string, request: { body: string; reply_to_message_id: string | null }): Promise<ChannelMessage> {
    this.posts.push({ body: request.body, replyTo: request.reply_to_message_id, token });
    return {
      id: "msg-agent",
      channel_id: "chan-1",
      sequence: 2,
      sender,
      body: request.body,
      mentions: [],
      reply_to_message_id: request.reply_to_message_id,
      created_at: 2,
    };
  }

  async postStatus(): Promise<StatusUpdate> {
    return { channel_id: "chan-1", sequence: 1, participant: sender, state: "waiting", scope: null, created_at: 1 };
  }

  watchChannel(): ChannelSubscription {
    return { close: () => undefined };
  }
}

describe("PendingQueue", () => {
  it("creates and edits pending drafts", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const store = new MemoryPendingQueueStore();
    const queue = new PendingQueue(store, new MemoryProfileStore(), new FakeProtocolClient());

    const draft = await queue.create(input);
    const edited = await queue.edit(draft.id, "edited body");

    expect(edited.body).toBe("edited body");
    expect(edited.createdAt).toBe(1000);
    expect(edited.updatedAt).toBe(2000);
  });

  it("discards drafts without posting", async () => {
    const store = new MemoryPendingQueueStore();
    const protocol = new FakeProtocolClient();
    const queue = new PendingQueue(store, new MemoryProfileStore(), protocol);
    const draft = await queue.create(input);

    await queue.discard(draft.id);

    await expect(queue.list()).resolves.toEqual([]);
    expect(protocol.posts).toEqual([]);
  });

  it("sends pending drafts as replies and removes them", async () => {
    const store = new MemoryPendingQueueStore();
    const profiles = new MemoryProfileStore();
    await profiles.saveProfile({
      id: "profile-1",
      name: "Agent profile",
      serverUrl: "http://127.0.0.1:4180",
      channelId: "chan-1",
      token: "agent-token",
    });
    const protocol = new FakeProtocolClient();
    const queue = new PendingQueue(store, profiles, protocol);
    const draft = await queue.create(input);

    await queue.send(draft);

    expect(protocol.posts).toEqual([{ body: "draft body", replyTo: "msg-1", token: "agent-token" }]);
    await expect(queue.list()).resolves.toEqual([]);
  });
});
