// Generated from Rust protocol definitions in src/protocol.rs.
// Update Rust protocol types first, then refresh this contract.

export type HealthResponse = { ok: boolean, service: string, version: string, database: DatabaseStatus, };

export type DatabaseStatus = { connected: boolean, };

export type ErrorResponse = { error: ProtocolError, };

export type ProtocolError = { code: string, message: string, };

export type AdminLoginRequest = { admin_secret: string, };

export type AdminLoginResponse = { ok: boolean, expires_in_seconds: number, };

export type CreateChannelRequest = { name: string, mode: ChannelMode, };

export type ChannelResponse = { id: string, name: string, mode: ChannelMode, created_at: number, };

export type ChannelMode = "normal" | "party";

export type MintTokenRequest = { kind: TokenKind, owner_label: string, };

export type MintTokenResponse = { token: string, metadata: TokenMetadata, };

export type TokenMetadata = { id: string, kind: TokenKind, owner_label: string, created_at: number, revoked_at: number | null, };

export type TokenKind = "human" | "agent";

export type AuthenticatedTokenResponse = { token: TokenMetadata, };

export type PostMessageRequest = { body: string, mentions: Array<string>, reply_to_message_id: string | null, };

export type PostStatusRequest = { state: ParticipantStatusState, };

export type ChannelHistoryResponse = { events: Array<ChannelEvent>, last_sequence: number, };

export type WebSocketClientFrame = { "type": "Message", "payload": PostMessageRequest } | { "type": "Status", "payload": PostStatusRequest };

export type ChannelEvent = { "type": "Message", "payload": ChannelMessage } | { "type": "Status", "payload": StatusUpdate } | { "type": "Presence", "payload": PresenceUpdate };

export type ChannelMessage = { id: string, channel_id: string, sequence: number, sender: TokenMetadata, body: string, mentions: Array<string>, reply_to_message_id: string | null, created_at: number, };

export type StatusUpdate = { channel_id: string, sequence: number, participant: TokenMetadata, state: ParticipantStatusState, created_at: number, };

export type PresenceUpdate = { channel_id: string, participant: TokenMetadata, state: PresenceState, };

export type ParticipantStatusState = "waiting" | "working" | "blocked" | "done";

export type PresenceState = "online" | "offline";

export type WebSocketFrame = { "type": "Welcome", "payload": WebSocketWelcomeFrame } | { "type": "Message", "payload": ChannelMessage } | { "type": "Status", "payload": StatusUpdate } | { "type": "Presence", "payload": PresenceUpdate } | { "type": "Sent", "payload": SentAckFrame } | { "type": "Error", "payload": ProtocolError };

export type WebSocketWelcomeFrame = { channel: ChannelResponse, self_token: TokenMetadata, participants: Array<PresenceUpdate>, last_sequence: number, protocol_version: number, };

export type SentAckFrame = { channel_id: string, sequence: number, };
