import { beforeEach, describe, expect, it } from "vitest";
import { MemoryProfileStore } from "./profileStore";
import type { ChannelEvent, ChannelMessage, ServerProfile, TokenMetadata } from "./types";
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

class FakeProtocolClient implements ProtocolClient {
  history: ChannelEvent[] = [];
  posted: { body: string; replyTo: string | null }[] = [];
  watcher: ((event: ChannelEvent) => void) | null = null;
  disconnected: (() => void) | null = null;
  loadAfter: number | undefined;

  async loadHistory(_profile: ServerProfile, _token: string, afterSequence?: number) {
    this.loadAfter = afterSequence;
    const events = afterSequence ? this.history.filter((event) => "sequence" in event.payload && event.payload.sequence > afterSequence) : this.history;
    return { events, last_sequence: events.reduce((max, event) => ("sequence" in event.payload ? Math.max(max, event.payload.sequence) : max), afterSequence ?? 0) };
  }

  async postMessage(_profile: ServerProfile, _token: string, request: { body: string; reply_to_message_id: string | null }) {
    this.posted.push({ body: request.body, replyTo: request.reply_to_message_id });
    return message(10 + this.posted.length, request.body, request.reply_to_message_id);
  }

  watchChannel(_profile: ServerProfile, _token: string, onEvent: (event: ChannelEvent) => void, onDisconnect: () => void): ChannelSubscription {
    this.watcher = onEvent;
    this.disconnected = onDisconnect;
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
    protocol.history = [{ type: "Message", payload: message(1, "existing") }];
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    protocol.watcher?.({ type: "Message", payload: message(2, "live") });

    expect(model.getSnapshot().connectionState).toBe("connected");
    expect(model.getSnapshot().messages.map((item) => item.body)).toEqual(["existing", "live"]);
  });

  it("sends replies to the selected message", async () => {
    protocol.history = [{ type: "Message", payload: message(1, "question") }];
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    model.selectReplyTo("msg-1");
    await model.send("answer");

    expect(protocol.posted).toEqual([{ body: "answer", replyTo: "msg-1" }]);
    expect(model.getSnapshot().selectedReplyTo).toBeNull();
  });

  it("sends new channel messages without a reply target", async () => {
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    await model.send("standalone");

    expect(protocol.posted).toEqual([{ body: "standalone", replyTo: null }]);
    expect(model.getSnapshot().messages.map((item) => item.body)).toEqual(["standalone"]);
  });

  it("keeps history visible and disables sending after disconnect", async () => {
    protocol.history = [{ type: "Message", payload: message(1, "existing") }];
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    protocol.disconnected?.();

    expect(model.getSnapshot().messages).toHaveLength(1);
    expect(model.canSend()).toBe(false);
    await expect(model.send("offline")).rejects.toThrow("Cannot send while disconnected");
  });

  it("catches up after the last loaded sequence", async () => {
    protocol.history = [
      { type: "Message", payload: message(1, "one") },
      { type: "Message", payload: message(2, "two") },
    ];
    const model = new WorkbenchModel(profiles, protocol);

    await model.connect(profile);
    protocol.history.push({ type: "Message", payload: message(3, "three") });
    await model.catchUp();

    expect(protocol.loadAfter).toBe(2);
    expect(model.getSnapshot().messages.map((item) => item.body)).toEqual(["one", "two", "three"]);
  });
});
