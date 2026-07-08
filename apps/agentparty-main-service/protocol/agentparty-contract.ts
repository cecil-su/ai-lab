// Generated from Rust protocol definitions in src/protocol.rs.
// Update Rust protocol types first, then refresh this contract.

export type HealthResponse = { ok: boolean, service: string, version: string, database: DatabaseStatus, };

export type DatabaseStatus = { connected: boolean, };

export type ErrorResponse = { error: ProtocolError, };

export type ProtocolError = { code: string, message: string, };

export type WebSocketFrame = { "type": "Welcome", "payload": WelcomeFrame } | { "type": "Error", "payload": ProtocolError };

export type WelcomeFrame = { connection_id: string, protocol_version: number, };
