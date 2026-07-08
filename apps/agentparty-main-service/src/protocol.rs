use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const SERVICE_NAME: &str = "agentparty-main-service";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct HealthResponse {
    pub ok: bool,
    pub service: String,
    pub version: String,
    pub database: DatabaseStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct DatabaseStatus {
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct ErrorResponse {
    pub error: ProtocolError,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct ProtocolError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct AdminLoginRequest {
    pub admin_secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct AdminLoginResponse {
    pub ok: bool,
    #[ts(type = "number")]
    pub expires_in_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct CreateChannelRequest {
    pub name: String,
    pub mode: ChannelMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct ChannelResponse {
    pub id: String,
    pub name: String,
    pub mode: ChannelMode,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
pub enum ChannelMode {
    Normal,
    Party,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct MintTokenRequest {
    pub kind: TokenKind,
    pub owner_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct MintTokenResponse {
    pub token: String,
    pub metadata: TokenMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct TokenMetadata {
    pub id: String,
    pub kind: TokenKind,
    pub owner_label: String,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number | null")]
    pub revoked_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
pub enum TokenKind {
    Human,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct AuthenticatedTokenResponse {
    pub token: TokenMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct PostMessageRequest {
    pub body: String,
    pub mentions: Vec<String>,
    pub reply_to_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct PostStatusRequest {
    pub state: ParticipantStatusState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct ChannelHistoryResponse {
    pub events: Vec<ChannelEvent>,
    #[ts(type = "number")]
    pub last_sequence: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "type", content = "payload")]
pub enum WebSocketClientFrame {
    Message(PostMessageRequest),
    Status(PostStatusRequest),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "type", content = "payload")]
pub enum ChannelEvent {
    Message(ChannelMessage),
    Status(StatusUpdate),
    Presence(PresenceUpdate),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct ChannelMessage {
    pub id: String,
    pub channel_id: String,
    #[ts(type = "number")]
    pub sequence: i64,
    pub sender: TokenMetadata,
    pub body: String,
    pub mentions: Vec<String>,
    pub reply_to_message_id: Option<String>,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct StatusUpdate {
    pub channel_id: String,
    #[ts(type = "number")]
    pub sequence: i64,
    pub participant: TokenMetadata,
    pub state: ParticipantStatusState,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct PresenceUpdate {
    pub channel_id: String,
    pub participant: TokenMetadata,
    pub state: PresenceState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantStatusState {
    Waiting,
    Working,
    Blocked,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
pub enum PresenceState {
    Online,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "type", content = "payload")]
pub enum WebSocketFrame {
    Welcome(WebSocketWelcomeFrame),
    Message(ChannelMessage),
    Status(StatusUpdate),
    Presence(PresenceUpdate),
    Sent(SentAckFrame),
    Error(ProtocolError),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct WebSocketWelcomeFrame {
    pub channel: ChannelResponse,
    pub self_token: TokenMetadata,
    pub participants: Vec<PresenceUpdate>,
    #[ts(type = "number")]
    pub last_sequence: i64,
    pub protocol_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct SentAckFrame {
    pub channel_id: String,
    #[ts(type = "number")]
    pub sequence: i64,
}

pub fn health_response() -> HealthResponse {
    HealthResponse {
        ok: true,
        service: SERVICE_NAME.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        database: DatabaseStatus { connected: true },
    }
}

pub fn typescript_contract() -> &'static str {
    include_str!("../protocol/agentparty-contract.ts")
}

pub fn generated_typescript_contract() -> String {
    [
        "// Generated from Rust protocol definitions in src/protocol.rs.",
        "// Update Rust protocol types first, then refresh this contract.",
        "",
        &format!("export {}", HealthResponse::decl()),
        "",
        &format!("export {}", DatabaseStatus::decl()),
        "",
        &format!("export {}", ErrorResponse::decl()),
        "",
        &format!("export {}", ProtocolError::decl()),
        "",
        &format!("export {}", AdminLoginRequest::decl()),
        "",
        &format!("export {}", AdminLoginResponse::decl()),
        "",
        &format!("export {}", CreateChannelRequest::decl()),
        "",
        &format!("export {}", ChannelResponse::decl()),
        "",
        &format!("export {}", ChannelMode::decl()),
        "",
        &format!("export {}", MintTokenRequest::decl()),
        "",
        &format!("export {}", MintTokenResponse::decl()),
        "",
        &format!("export {}", TokenMetadata::decl()),
        "",
        &format!("export {}", TokenKind::decl()),
        "",
        &format!("export {}", AuthenticatedTokenResponse::decl()),
        "",
        &format!("export {}", PostMessageRequest::decl()),
        "",
        &format!("export {}", PostStatusRequest::decl()),
        "",
        &format!("export {}", ChannelHistoryResponse::decl()),
        "",
        &format!("export {}", WebSocketClientFrame::decl()),
        "",
        &format!("export {}", ChannelEvent::decl()),
        "",
        &format!("export {}", ChannelMessage::decl()),
        "",
        &format!("export {}", StatusUpdate::decl()),
        "",
        &format!("export {}", PresenceUpdate::decl()),
        "",
        &format!("export {}", ParticipantStatusState::decl()),
        "",
        &format!("export {}", PresenceState::decl()),
        "",
        &format!("export {}", WebSocketFrame::decl()),
        "",
        &format!("export {}", WebSocketWelcomeFrame::decl()),
        "",
        &format!("export {}", SentAckFrame::decl()),
        "",
    ]
    .join("\n")
}
