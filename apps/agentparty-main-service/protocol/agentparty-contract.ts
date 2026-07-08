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

export type WebSocketFrame = { "type": "Welcome", "payload": WelcomeFrame } | { "type": "Error", "payload": ProtocolError };

export type WelcomeFrame = { connection_id: string, protocol_version: number, };
