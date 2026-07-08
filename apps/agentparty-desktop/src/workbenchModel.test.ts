import { beforeEach, describe, expect, it } from "vitest";
import { MemoryProfileStore } from "./profileStore";
import type { ChannelEvent, ChannelMessage, ServerProfile, StatusUpdate, TokenMetadata } from "./types";
import type { ChannelSubscription, ProtocolClient } from "./protocolClient";
import { WorkbenchModel } from "./workbenchModel";

const human: TokenMetadata = {
  id: "tok-human",
  kind: "human",
  owner_label: "Ada",
  created_at: 1,
  revoked_at: null,
};

function message(sequence: number, body: string, replyTo: string | null = null): ChannelMessage {
  return {
    id: `msg-${sequence}`,
    channel_id: "chan-1",
    sequence,
    sender: human,
    body,
    mentions: [],
    reply_to_message_id: replyTo,
    created_at: sequence,
  };
}

function channelMessage(channelId: string, sequence: number, body: string, replyTo: string | null = null): ChannelMessage {
  return {
    ...message(sequence, body, replyTo),
    id: `${channelId}-msg-${sequence}`,
    channel_id: channelId,
  };
}

class FakeProtocolClient implements ProtocolClient {
  history = new Map<string, ChannelEvent[]>();
  posted: { channelId: string; body: string; replyTo: string | null }[] = [];
  watchers = new Map<string, (event: ChannelEvent) => void>();
  disconnected = new Map<string, () => void>();
  loadAfter = new Map<string, number | undefined>();

  async loadHistory(profile: ServerProfile, _token: string, afterSequence?: number) {
    this.loadAfter.set(profile.channelId, afterSequence);
    const history = this.history.get(profile.channelId) ?? [];
    const events = afterSequence ? history.filter((event) => "sequence" in event.payload && event.payload.sequence > afterSequence) : history;
    return { events, last_sequence: events.reduce((max, event) => ("sequence" in event.payload ? Math.max(max, event.payload.sequence) : max), afterSequence ?? 0) };
  }

  async postMessage(profile: ServerProfile, _token: string, request: { body: string; reply_to_message_id: string | null }) {
    this.posted.push({ channelId: profile.channelId, body: request.body, replyTo: request.reply_to_message_id });
    return channelMessage(profile.channelId, 10 + this.posted.length, request.body, request.reply_to_message_id);
  }

  async postStatus(): Promise<StatusUpdate> {
    return {
      channel_id: "chan-1",
      sequence: 1,
      participant: human,
      state: "waiting",
      created_at: 1,
    };
  }

  watchChannel(profile: ServerProfile, _token: string, onEvent: (event: ChannelEvent) => void, onDisconnect: () => void): ChannelSubscription {
    this.watchers.set(profile.channelId, onEvent);
    this.disconnected.set(profile.channelId, onDisconnect);
    return { close: () => undefined };
  }
}

describe("WorkbenchModel", () => {
  let profiles: MemoryProfileStore;
  let protocol: FakeProtocolClient;
  let profile: ServerProfile;

  beforeEach(async () => {
    profiles = new MemoryProfileStore();
    protocol = new FakeProtocolClient();
    profile = await profiles.saveProfile({
      name: "Local",
      serverUrl: "http://127.0.0.1:4180",
      channelId: "chan-1",
      token: "token-1",
    });
  });

  it("loads channel history and receives websocket messages", async () => {
    protocol.history.set("chan-1", [{ type: "Message", payload: message(1, "existing") }]);
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    protocol.watchers.get("chan-1")?.({ type: "Message", payload: message(2, "live") });

    expect(model.getSnapshot().connectionState).toBe("connected");
    expect(model.getSnapshot().messages.map((item) => item.body)).toEqual(["existing", "live"]);
  });

  it("sends replies to the selected message", async () => {
    protocol.history.set("chan-1", [{ type: "Message", payload: message(1, "question") }]);
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    model.selectReplyTo("msg-1");
    await model.send("answer");

    expect(protocol.posted).toEqual([{ channelId: "chan-1", body: "answer", replyTo: "msg-1" }]);
    expect(model.getSnapshot().selectedReplyTo).toBeNull();
  });

  it("sends new channel messages without a reply target", async () => {
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    await model.send("standalone");

    expect(protocol.posted).toEqual([{ channelId: "chan-1", body: "standalone", replyTo: null }]);
    expect(model.getSnapshot().messages.map((item) => item.body)).toEqual(["standalone"]);
  });

  it("keeps history visible and disables sending after disconnect", async () => {
    protocol.history.set("chan-1", [{ type: "Message", payload: message(1, "existing") }]);
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    protocol.disconnected.get("chan-1")?.();

    expect(model.getSnapshot().messages).toHaveLength(1);
    expect(model.canSend()).toBe(false);
    await expect(model.send("offline")).rejects.toThrow("Cannot send while disconnected");
  });

  it("catches up after the last loaded sequence", async () => {
    protocol.history.set("chan-1", [
      { type: "Message", payload: message(1, "one") },
      { type: "Message", payload: message(2, "two") },
    ]);
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    protocol.history.get("chan-1")?.push({ type: "Message", payload: message(3, "three") });
    await model.catchUp();

    expect(protocol.loadAfter.get("chan-1")).toBe(2);
    expect(model.getSnapshot().messages.map((item) => item.body)).toEqual(["one", "two", "three"]);
  });

  it("reconnects a channel after its own last loaded sequence", async () => {
    protocol.history.set("chan-1", [
      { type: "Message", payload: message(1, "one") },
      { type: "Message", payload: message(2, "two") },
    ]);
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    model.disconnect(true, profile.id);
    protocol.history.get("chan-1")?.push({ type: "Message", payload: message(3, "three") });
    await model.connect(profile);

    expect(protocol.loadAfter.get("chan-1")).toBe(2);
    expect(model.getSnapshot().messages.map((item) => item.body)).toEqual(["one", "two", "three"]);
  });

  it("switches between connected channels without losing loaded state", async () => {
    const otherProfile = await profiles.saveProfile({
      name: "Other",
      serverUrl: "http://127.0.0.1:4180",
      channelId: "chan-2",
      token: "token-2",
    });
    protocol.history.set("chan-1", [{ type: "Message", payload: channelMessage("chan-1", 1, "one") }]);
    protocol.history.set("chan-2", [{ type: "Message", payload: channelMessage("chan-2", 1, "two") }]);
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    await model.connect(otherProfile);
    model.switchChannel(profile.id);

    expect(model.getSnapshot().profile?.channelId).toBe("chan-1");
    expect(model.getSnapshot().messages.map((item) => item.body)).toEqual(["one"]);
    model.switchChannel(otherProfile.id);
    expect(model.getSnapshot().messages.map((item) => item.body)).toEqual(["two"]);
  });

  it("increments unread for non-active channels and clears unread when viewed", async () => {
    const otherProfile = await profiles.saveProfile({
      name: "Other",
      serverUrl: "http://127.0.0.1:4180",
      channelId: "chan-2",
      token: "token-2",
    });
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    await model.connect(otherProfile);
    model.switchChannel(profile.id);
    protocol.watchers.get("chan-2")?.({ type: "Message", payload: channelMessage("chan-2", 1, "background") });

    expect(model.getSnapshot().channels.find((channel) => channel.profile.id === otherProfile.id)?.unreadCount).toBe(1);
    model.switchChannel(otherProfile.id);
    expect(model.getSnapshot().channels.find((channel) => channel.profile.id === otherProfile.id)?.unreadCount).toBe(0);
    expect(model.getSnapshot().messages.map((item) => item.body)).toEqual(["background"]);
  });

  it("does not increment unread for background catch-up history", async () => {
    const otherProfile = await profiles.saveProfile({
      name: "Other",
      serverUrl: "http://127.0.0.1:4180",
      channelId: "chan-2",
      token: "token-2",
    });
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    await model.connect(otherProfile);
    model.switchChannel(profile.id);
    protocol.history.set("chan-2", [{ type: "Message", payload: channelMessage("chan-2", 1, "background history") }]);
    await model.catchUp(otherProfile.id);

    expect(model.getSnapshot().channels.find((channel) => channel.profile.id === otherProfile.id)?.unreadCount).toBe(0);
  });

  it("keeps reply compose state isolated per channel", async () => {
    const otherProfile = await profiles.saveProfile({
      name: "Other",
      serverUrl: "http://127.0.0.1:4180",
      channelId: "chan-2",
      token: "token-2",
    });
    protocol.history.set("chan-1", [{ type: "Message", payload: channelMessage("chan-1", 1, "one") }]);
    protocol.history.set("chan-2", [{ type: "Message", payload: channelMessage("chan-2", 1, "two") }]);
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    model.selectReplyTo("chan-1-msg-1");
    await model.connect(otherProfile);

    expect(model.getSnapshot().selectedReplyTo).toBeNull();
    model.switchChannel(profile.id);
    expect(model.getSnapshot().selectedReplyTo?.id).toBe("chan-1-msg-1");
  });

  it("keeps composer body and mentions isolated per channel", async () => {
    const otherProfile = await profiles.saveProfile({
      name: "Other",
      serverUrl: "http://127.0.0.1:4180",
      channelId: "chan-2",
      token: "token-2",
    });
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    model.updateComposerDraft({ composerBody: "draft one", composerMentions: "bot" });
    await model.connect(otherProfile);

    expect(model.getSnapshot().composerBody).toBe("");
    expect(model.getSnapshot().composerMentions).toBe("");
    model.switchChannel(profile.id);
    expect(model.getSnapshot().composerBody).toBe("draft one");
    expect(model.getSnapshot().composerMentions).toBe("bot");
  });

  it("keeps presence isolated per channel", async () => {
    const otherProfile = await profiles.saveProfile({
      name: "Other",
      serverUrl: "http://127.0.0.1:4180",
      channelId: "chan-2",
      token: "token-2",
    });
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    await model.connect(otherProfile);
    protocol.watchers.get("chan-1")?.({
      type: "Presence",
      payload: { channel_id: "chan-1", participant: human, state: "online" },
    });

    expect(model.getSnapshot().presence).toEqual([]);
    model.switchChannel(profile.id);
    expect(model.getSnapshot().presence.map((item) => item.channel_id)).toEqual(["chan-1"]);
  });
});
