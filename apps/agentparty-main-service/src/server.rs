use crate::db::open_database;
use crate::protocol::{health_response, HealthResponse};
use crate::ServiceConfig;
use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use std::sync::Arc;
use tokio::net::TcpListener;

#[derive(Clone)]
pub struct AppState {
    database_path: Arc<std::path::PathBuf>,
}

pub fn build_router(config: ServiceConfig) -> anyhow::Result<Router> {
    let connection = open_database(&config.database_path)?;
    drop(connection);

    let state = AppState {
        database_path: Arc::new(config.database_path),
    };

    Ok(Router::new()
        .route("/health", get(health))
        .with_state(state))
}

pub async fn run(config: ServiceConfig) -> anyhow::Result<()> {
    let addr = config.socket_addr();
    let app = build_router(config)?;
    let listener = TcpListener::bind(addr).await?;

    println!("agentparty-main-service listening on http://{addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let connected = open_database(&state.database_path).is_ok();
    let mut response = health_response();
    response.database.connected = connected;
    Json(response)
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
