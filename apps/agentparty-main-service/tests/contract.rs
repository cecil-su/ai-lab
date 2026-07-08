use agentparty_main_service::protocol::{
    generated_typescript_contract, health_response, ChannelMode, ChannelResponse, ProtocolError,
    TokenKind, TokenMetadata, WebSocketFrame, WebSocketWelcomeFrame,
};

#[test]
fn committed_typescript_contract_matches_rust_protocol_export() {
    let committed = include_str!("../protocol/agentparty-contract.ts");
    assert_eq!(committed, generated_typescript_contract());
}

#[test]
fn health_response_json_shape_is_stable() {
    let json = serde_json::to_string_pretty(&health_response()).expect("json");
    assert_eq!(
        json,
        r#"{
  "ok": true,
  "service": "agentparty-main-service",
  "version": "0.1.0",
  "database": {
    "connected": true
  }
}"#
    );
}

#[test]
fn websocket_frame_json_shape_is_stable() {
    let token = TokenMetadata {
        id: "tok_123".to_string(),
        kind: TokenKind::Human,
        owner_label: "Ada".to_string(),
        created_at: 100,
        revoked_at: None,
    };
    let welcome = WebSocketFrame::Welcome(WebSocketWelcomeFrame {
        channel: ChannelResponse {
            id: "chan_123".to_string(),
            name: "general".to_string(),
            mode: ChannelMode::Normal,
            created_at: 99,
        },
        self_token: token,
        participants: Vec::new(),
        last_sequence: 7,
        protocol_version: 1,
    });
    let error = WebSocketFrame::Error(ProtocolError {
        code: "bad_request".to_string(),
        message: "Invalid request".to_string(),
    });

    assert_eq!(
        serde_json::to_string(&welcome).expect("welcome json"),
        r#"{"type":"Welcome","payload":{"channel":{"id":"chan_123","name":"general","mode":"normal","created_at":99},"self_token":{"id":"tok_123","kind":"human","owner_label":"Ada","created_at":100,"revoked_at":null},"participants":[],"last_sequence":7,"protocol_version":1}}"#
    );
    assert_eq!(
        serde_json::to_string(&error).expect("error json"),
        r#"{"type":"Error","payload":{"code":"bad_request","message":"Invalid request"}}"#
    );
}
