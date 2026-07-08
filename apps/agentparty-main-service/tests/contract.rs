use agentparty_main_service::protocol::{
    generated_typescript_contract, health_response, ProtocolError, WebSocketFrame, WelcomeFrame,
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
    let welcome = WebSocketFrame::Welcome(WelcomeFrame {
        connection_id: "conn_123".to_string(),
        protocol_version: 1,
    });
    let error = WebSocketFrame::Error(ProtocolError {
        code: "bad_request".to_string(),
        message: "Invalid request".to_string(),
    });

    assert_eq!(
        serde_json::to_string(&welcome).expect("welcome json"),
        r#"{"type":"Welcome","payload":{"connection_id":"conn_123","protocol_version":1}}"#
    );
    assert_eq!(
        serde_json::to_string(&error).expect("error json"),
        r#"{"type":"Error","payload":{"code":"bad_request","message":"Invalid request"}}"#
    );
}
