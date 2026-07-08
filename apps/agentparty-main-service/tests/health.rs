use agentparty_main_service::{build_router, ServiceConfig};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use std::net::{IpAddr, Ipv4Addr};
use tempfile::tempdir;
use tower::ServiceExt;

#[tokio::test]
async fn health_endpoint_returns_success_response_and_creates_database() {
    let tempdir = tempdir().expect("tempdir");
    let database_path = tempdir.path().join("agentparty.sqlite3");
    let app = build_router(ServiceConfig {
        host: IpAddr::V4(Ipv4Addr::LOCALHOST),
        port: 0,
        database_path: database_path.clone(),
    })
    .expect("router");

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let json: serde_json::Value = serde_json::from_slice(&body).expect("json");

    assert_eq!(json["ok"], true);
    assert_eq!(json["service"], "agentparty-main-service");
    assert_eq!(json["database"]["connected"], true);
    assert!(database_path.exists());
}
