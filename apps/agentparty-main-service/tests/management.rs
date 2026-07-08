use agentparty_main_service::{build_router, ServiceConfig};
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use tempfile::tempdir;
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

#[tokio::test]
async fn invalid_admin_login_is_generic_and_does_not_create_session() {
    let tempdir = tempdir().expect("tempdir");
    let app = build_router(config(tempdir.path().join("service.sqlite3"))).expect("router");

    let (status, headers, body) = request(
        app,
        Method::POST,
        "/admin/login",
        None,
        None,
        json!({ "admin_secret": "wrong" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"]["code"], "unauthorized");
    assert!(headers.get("set-cookie").is_none());
}

#[tokio::test]
async fn management_page_prompts_for_admin_secret_before_login() {
    let tempdir = tempdir().expect("tempdir");
    let app = build_router(config(tempdir.path().join("service.sqlite3"))).expect("router");

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/admin")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let html = String::from_utf8(body.to_vec()).expect("html");
    assert!(html.contains("Admin secret"));
    assert!(html.contains("/admin/login"));
}

#[tokio::test]
async fn management_page_exposes_channel_token_and_revoke_controls_after_login() {
    let tempdir = tempdir().expect("tempdir");
    let app = build_router(config(tempdir.path().join("service.sqlite3"))).expect("router");
    let cookie = login(app.clone()).await;

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/admin")
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let html = String::from_utf8(body.to_vec()).expect("html");
    assert!(html.contains("channel-list"));
    assert!(html.contains("token-list"));
    assert!(html.contains("/revoke"));
}

#[tokio::test]
async fn admin_can_create_normal_and_party_channels_that_persist() {
    let tempdir = tempdir().expect("tempdir");
    let database_path = tempdir.path().join("service.sqlite3");
    let app = build_router(config(database_path.clone())).expect("router");
    let cookie = login(app.clone()).await;

    let (normal_status, _, normal) = request(
        app.clone(),
        Method::POST,
        "/admin/api/channels",
        Some(&cookie),
        None,
        json!({ "name": "general", "mode": "normal" }),
    )
    .await;
    let (party_status, _, party) = request(
        app,
        Method::POST,
        "/admin/api/channels",
        Some(&cookie),
        None,
        json!({ "name": "ship-room", "mode": "party" }),
    )
    .await;

    assert_eq!(normal_status, StatusCode::CREATED);
    assert_eq!(party_status, StatusCode::CREATED);
    assert_eq!(normal["mode"], "normal");
    assert_eq!(party["mode"], "party");

    let restarted = build_router(config(database_path)).expect("router");
    let restarted_cookie = login(restarted.clone()).await;
    let (list_status, _, channels) = request(
        restarted,
        Method::GET,
        "/admin/api/channels",
        Some(&restarted_cookie),
        None,
        Value::Null,
    )
    .await;

    assert_eq!(list_status, StatusCode::OK);
    assert_eq!(channels.as_array().expect("channels").len(), 2);
}

#[tokio::test]
async fn admin_can_mint_list_and_revoke_tokens_without_revealing_secrets_in_metadata() {
    let tempdir = tempdir().expect("tempdir");
    let database_path = tempdir.path().join("service.sqlite3");
    let app = build_router(config(database_path.clone())).expect("router");
    let cookie = login(app.clone()).await;

    let (human_status, _, human) = request(
        app.clone(),
        Method::POST,
        "/admin/api/tokens",
        Some(&cookie),
        None,
        json!({ "kind": "human", "owner_label": "Ada" }),
    )
    .await;
    let (agent_status, _, agent) = request(
        app.clone(),
        Method::POST,
        "/admin/api/tokens",
        Some(&cookie),
        None,
        json!({ "kind": "agent", "owner_label": "Ada/codex" }),
    )
    .await;

    assert_eq!(human_status, StatusCode::CREATED);
    assert_eq!(agent_status, StatusCode::CREATED);
    let human_secret = human["token"].as_str().expect("human token").to_string();
    let agent_secret = agent["token"].as_str().expect("agent token").to_string();
    let human_id = human["metadata"]["id"]
        .as_str()
        .expect("human id")
        .to_string();
    assert_ne!(human_secret, agent_secret);

    let (list_status, _, tokens) = request(
        app.clone(),
        Method::GET,
        "/admin/api/tokens",
        Some(&cookie),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(list_status, StatusCode::OK);
    let serialized = tokens.to_string();
    assert!(!serialized.contains(&human_secret));
    assert!(!serialized.contains(&agent_secret));
    assert_eq!(tokens.as_array().expect("tokens").len(), 2);

    let (auth_status, _, auth) = request(
        app.clone(),
        Method::GET,
        "/api/auth/me",
        None,
        Some(&human_secret),
        Value::Null,
    )
    .await;
    assert_eq!(auth_status, StatusCode::OK);
    assert_eq!(auth["token"]["owner_label"], "Ada");

    let (revoke_status, _, revoked) = request(
        app.clone(),
        Method::POST,
        &format!("/admin/api/tokens/{human_id}/revoke"),
        Some(&cookie),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(revoke_status, StatusCode::OK);
    assert!(revoked["revoked_at"].as_i64().is_some());

    let (revoked_auth_status, _, _) = request(
        app,
        Method::GET,
        "/api/auth/me",
        None,
        Some(&human_secret),
        Value::Null,
    )
    .await;
    assert_eq!(revoked_auth_status, StatusCode::UNAUTHORIZED);

    let restarted = build_router(config(database_path)).expect("router");
    let restarted_cookie = login(restarted.clone()).await;
    let (restarted_list_status, _, restarted_tokens) = request(
        restarted,
        Method::GET,
        "/admin/api/tokens",
        Some(&restarted_cookie),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(restarted_list_status, StatusCode::OK);
    assert_eq!(restarted_tokens.as_array().expect("tokens").len(), 2);
}
