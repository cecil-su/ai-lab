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
#[serde(tag = "type", content = "payload")]
pub enum WebSocketFrame {
    Welcome(WelcomeFrame),
    Error(ProtocolError),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct WelcomeFrame {
    pub connection_id: String,
    pub protocol_version: u32,
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
        &format!("export {}", WebSocketFrame::decl()),
        "",
        &format!("export {}", WelcomeFrame::decl()),
        "",
    ]
    .join("\n")
}
