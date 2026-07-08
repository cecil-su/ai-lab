use agentparty_main_service::{build_router, ServiceConfig};
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use tempfile::tempdir;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use tower::ServiceExt;

fn config(database_path: PathBuf) -> ServiceConfig {
    ServiceConfig {
        host: IpAddr::V4(Ipv4Addr::LOCALHOST),
        port: 0,
        database_path,
        admin_secret: "test-admin-secret".to_string(),
    }
}

async fn request(
    app: axum::Router,
    method: Method,
    uri: &str,
    cookie: Option<&str>,
    bearer: Option<&str>,
    body: Value,
) -> (StatusCode, HeaderMapText, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, cookie);
    }
    if let Some(bearer) = bearer {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {bearer}"));
    }
    let response = app
        .oneshot(builder.body(Body::from(body.to_string())).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let headers = HeaderMapText::from(response.headers());
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let json = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body).expect("json")
    };
    (status, headers, json)
}

#[derive(Debug)]
struct HeaderMapText(Vec<(String, String)>);

impl HeaderMapText {
    fn from(headers: &axum::http::HeaderMap) -> Self {
        Self(
            headers
                .iter()
                .map(|(name, value)| {
                    (
                        name.as_str().to_string(),
                        value.to_str().expect("header text").to_string(),
                    )
                })
                .collect(),
        )
    }

    fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

async fn login(app: axum::Router) -> String {
    let (status, headers, _) = request(
        app,
        Method::POST,
        "/admin/login",
        None,
        None,
        json!({ "admin_secret": "test-admin-secret" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    headers
        .get("set-cookie")
        .expect("set-cookie")
        .split(';')
        .next()
        .expect("cookie pair")
        .to_string()
}

async fn create_channel(app: axum::Router, cookie: &str) -> String {
    let (status, _, channel) = request(
        app,
        Method::POST,
        "/admin/api/channels",
        Some(cookie),
        None,
        json!({ "name": "general", "mode": "normal" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    channel["id"].as_str().expect("channel id").to_string()
}

async fn mint_token(
    app: axum::Router,
    cookie: &str,
    kind: &str,
    owner_label: &str,
) -> (String, String) {
    let (status, _, body) = request(
        app,
        Method::POST,
        "/admin/api/tokens",
        Some(cookie),
        None,
        json!({ "kind": kind, "owner_label": owner_label }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    (
        body["metadata"]["id"]
            .as_str()
            .expect("token id")
            .to_string(),
        body["token"].as_str().expect("token").to_string(),
    )
}

#[tokio::test]
async fn authenticated_rest_send_status_and_history_catch_up_persist_after_restart() {
    let tempdir = tempdir().expect("tempdir");
    let database_path = tempdir.path().join("service.sqlite3");
    let app = build_router(config(database_path.clone())).expect("router");
    let cookie = login(app.clone()).await;
    let channel_id = create_channel(app.clone(), &cookie).await;
    let (_, human_token) = mint_token(app.clone(), &cookie, "human", "Ada").await;

    let (message_status, _, message) = request(
        app.clone(),
        Method::POST,
        &format!("/api/channels/{channel_id}/messages"),
        None,
        Some(&human_token),
        json!({
            "body": "hello @bot",
            "mentions": ["bot"],
            "reply_to_message_id": null
        }),
    )
    .await;
    let (status_status, _, status) = request(
        app,
        Method::POST,
        &format!("/api/channels/{channel_id}/status"),
        None,
        Some(&human_token),
        json!({ "state": "working" }),
    )
    .await;

    assert_eq!(message_status, StatusCode::CREATED);
    assert_eq!(status_status, StatusCode::CREATED);
    assert_eq!(message["sequence"], 1);
    assert_eq!(message["mentions"], json!(["bot"]));
    assert_eq!(status["sequence"], 2);
    assert_eq!(status["state"], "working");

    let restarted = build_router(config(database_path)).expect("router");
    let (history_status, _, history) = request(
        restarted,
        Method::GET,
        &format!("/api/channels/{channel_id}/events?after_sequence=1"),
        None,
        Some(&human_token),
        Value::Null,
    )
    .await;

    assert_eq!(history_status, StatusCode::OK);
    assert_eq!(history["last_sequence"], 2);
    let events = history["events"].as_array().expect("events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["type"], "Status");
    assert_eq!(events[0]["payload"]["sequence"], 2);
}

#[tokio::test]
async fn invalid_and_revoked_tokens_are_rejected_from_rest() {
    let tempdir = tempdir().expect("tempdir");
    let app = build_router(config(tempdir.path().join("service.sqlite3"))).expect("router");
    let cookie = login(app.clone()).await;
    let channel_id = create_channel(app.clone(), &cookie).await;
    let (token_id, token) = mint_token(app.clone(), &cookie, "agent", "bot").await;

    let (invalid_status, _, _) = request(
        app.clone(),
        Method::POST,
        &format!("/api/channels/{channel_id}/messages"),
        None,
        Some("not-a-token"),
        json!({ "body": "bad", "mentions": [], "reply_to_message_id": null }),
    )
    .await;
    assert_eq!(invalid_status, StatusCode::UNAUTHORIZED);

    let (revoke_status, _, _) = request(
        app.clone(),
        Method::POST,
        &format!("/admin/api/tokens/{token_id}/revoke"),
        Some(&cookie),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(revoke_status, StatusCode::OK);

    let (revoked_status, _, _) = request(
        app,
        Method::POST,
        &format!("/api/channels/{channel_id}/messages"),
        None,
        Some(&token),
        json!({ "body": "bad", "mentions": [], "reply_to_message_id": null }),
    )
    .await;
    assert_eq!(revoked_status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn websocket_receives_welcome_message_delivery_and_rejects_invalid_token() {
    let tempdir = tempdir().expect("tempdir");
    let database_path = tempdir.path().join("service.sqlite3");
    let app = build_router(config(database_path)).expect("router");
    let cookie = login(app.clone()).await;
    let channel_id = create_channel(app.clone(), &cookie).await;
    let (_, token) = mint_token(app.clone(), &cookie, "human", "Ada").await;
    let (revoked_token_id, revoked_token) = mint_token(app.clone(), &cookie, "agent", "bot").await;

    let (addr, server_task) = spawn_server(app.clone()).await;
    let bad_url = format!("ws://{addr}/api/channels/{channel_id}/ws?token=bad");
    assert!(tokio_tungstenite::connect_async(bad_url).await.is_err());
    let (revoke_status, _, _) = request(
        app.clone(),
        Method::POST,
        &format!("/admin/api/tokens/{revoked_token_id}/revoke"),
        Some(&cookie),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(revoke_status, StatusCode::OK);
    let revoked_url = format!("ws://{addr}/api/channels/{channel_id}/ws?token={revoked_token}");
    assert!(tokio_tungstenite::connect_async(revoked_url).await.is_err());

    let url = format!("ws://{addr}/api/channels/{channel_id}/ws?token={token}");
    let (mut socket, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("websocket");
    let welcome = read_json_message(&mut socket).await;
    assert_eq!(welcome["type"], "Welcome");
    assert_eq!(welcome["payload"]["channel"]["id"], channel_id);
    assert_eq!(welcome["payload"]["self_token"]["owner_label"], "Ada");

    let (message_status, _, message) = request(
        app.clone(),
        Method::POST,
        &format!("/api/channels/{channel_id}/messages"),
        None,
        Some(&token),
        json!({
            "body": "from rest",
            "mentions": [],
            "reply_to_message_id": null
        }),
    )
    .await;
    assert_eq!(message_status, StatusCode::CREATED);

    let received = read_until_type(&mut socket, "Message").await;
    assert_eq!(received["payload"]["id"], message["id"]);
    assert_eq!(received["payload"]["body"], "from rest");

    let (status_status, _, status) = request(
        app,
        Method::POST,
        &format!("/api/channels/{channel_id}/status"),
        None,
        Some(&token),
        json!({ "state": "blocked" }),
    )
    .await;
    assert_eq!(status_status, StatusCode::CREATED);
    let status_frame = read_until_type(&mut socket, "Status").await;
    assert_eq!(status_frame["payload"]["sequence"], status["sequence"]);
    assert_eq!(status_frame["payload"]["state"], "blocked");

    write_json_message(
        &mut socket,
        json!({
            "type": "Message",
            "payload": {
                "body": "from websocket",
                "mentions": [],
                "reply_to_message_id": null
            }
        }),
    )
    .await;
    let sent = read_until_type(&mut socket, "Sent").await;
    assert_eq!(sent["payload"]["channel_id"], channel_id);
    assert!(sent["payload"]["sequence"].as_i64().expect("sequence") >= 3);

    server_task.abort();
}

async fn spawn_server(app: axum::Router) -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.expect("server");
    });
    (addr, task)
}

async fn read_json_message(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Value {
    use futures_util::StreamExt;

    loop {
        let message = socket.next().await.expect("message").expect("message ok");
        if let Message::Text(text) = message {
            return serde_json::from_str(&text).expect("json");
        }
    }
}

async fn read_until_type(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    frame_type: &str,
) -> Value {
    for _ in 0..10 {
        let frame = read_json_message(socket).await;
        if frame["type"] == frame_type {
            return frame;
        }
    }
    panic!("did not receive {frame_type}");
}

async fn write_json_message(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    value: Value,
) {
    use futures_util::SinkExt;

    socket
        .send(Message::Text(value.to_string().into()))
        .await
        .expect("send websocket message");
}
