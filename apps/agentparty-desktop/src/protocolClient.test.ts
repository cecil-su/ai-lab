import { describe, expect, it } from "vitest";
import { HttpProtocolClient } from "./protocolClient";
import type { ChannelMessage, ServerProfile } from "./types";

const profile: ServerProfile = {
  id: "profile-1",
  name: "Local",
  serverUrl: "http://127.0.0.1:4180",
  channelId: "chan-1",
  createdAt: 1,
  updatedAt: 1,
};

const message: ChannelMessage = {
  id: "msg-1",
  channel_id: "chan-1",
  sequence: 1,
  sender: {
    id: "tok-1",
    kind: "human",
    owner_label: "Ada",
    created_at: 1,
    revoked_at: null,
  },
  body: "hello",
  mentions: [],
  reply_to_message_id: null,
  created_at: 1,
};

describe("HttpProtocolClient", () => {
  it("uses the server catch-up query parameter", async () => {
    const seen: string[] = [];
    const client = new HttpProtocolClient(async (input) => {
      seen.push(String(input));
      return jsonResponse({ events: [], last_sequence: 4 });
    });

    await client.loadHistory(profile, "token", 3);

    expect(seen[0]).toContain("/api/channels/chan-1/events?after_sequence=3");
  });

  it("posts messages using the server's unwrapped ChannelMessage response", async () => {
    const client = new HttpProtocolClient(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ body: "hello", mentions: [], reply_to_message_id: null }));
      return jsonResponse(message, 201);
    });

    await expect(client.postMessage(profile, "token", { body: "hello", mentions: [], reply_to_message_id: null })).resolves.toEqual(message);
  });

  it("posts participant status for relay wakeability", async () => {
    const client = new HttpProtocolClient(async (input, init) => {
      expect(String(input)).toContain("/api/channels/chan-1/status");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ state: "working", scope: "apps/agentparty-desktop" }));
      return jsonResponse({
        channel_id: "chan-1",
        sequence: 1,
        participant: message.sender,
        state: "working",
        scope: "apps/agentparty-desktop",
        created_at: 1,
      }, 201);
    });

    await expect(client.postStatus(profile, "token", { state: "working", scope: "apps/agentparty-desktop" })).resolves.toEqual(
      expect.objectContaining({ state: "working", scope: "apps/agentparty-desktop" }),
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
