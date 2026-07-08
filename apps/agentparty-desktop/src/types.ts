export type ChannelMode = "normal" | "party";
export type TokenKind = "human" | "agent";
export type ParticipantStatusState = "waiting" | "working" | "blocked" | "done";
export type PresenceState = "online" | "offline";

export type TokenMetadata = {
  id: string;
  kind: TokenKind;
  owner_label: string;
  created_at: number;
  revoked_at: number | null;
};

export type ChannelResponse = {
  id: string;
  name: string;
  mode: ChannelMode;
  created_at: number;
};

export type PostMessageRequest = {
  body: string;
  mentions: string[];
  reply_to_message_id: string | null;
};

export type ChannelHistoryResponse = {
  events: ChannelEvent[];
  last_sequence: number;
};

export type ChannelEvent =
  | { type: "Message"; payload: ChannelMessage }
  | { type: "Status"; payload: StatusUpdate }
  | { type: "Presence"; payload: PresenceUpdate };

export type ChannelMessage = {
  id: string;
  channel_id: string;
  sequence: number;
  sender: TokenMetadata;
  body: string;
  mentions: string[];
  reply_to_message_id: string | null;
  created_at: number;
};

export type StatusUpdate = {
  channel_id: string;
  sequence: number;
  participant: TokenMetadata;
  state: ParticipantStatusState;
  created_at: number;
};

export type PresenceUpdate = {
  channel_id: string;
  participant: TokenMetadata;
  state: PresenceState;
};

export type WebSocketFrame =
  | { type: "Welcome"; payload: { channel: ChannelResponse; self_token: TokenMetadata; participants: PresenceUpdate[]; last_sequence: number; protocol_version: number } }
  | { type: "Message"; payload: ChannelMessage }
  | { type: "Status"; payload: StatusUpdate }
  | { type: "Presence"; payload: PresenceUpdate }
  | { type: "Sent"; payload: { channel_id: string; sequence: number } }
  | { type: "Error"; payload: { code: string; message: string } };

export type ServerProfile = {
  id: string;
  name: string;
  serverUrl: string;
  channelId: string;
  createdAt: number;
  updatedAt: number;
};

export type ServerProfileInput = {
  id?: string;
  name: string;
  serverUrl: string;
  channelId: string;
  token: string;
};
