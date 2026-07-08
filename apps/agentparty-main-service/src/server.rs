use crate::db::{
    authenticate_token, create_channel as db_create_channel, list_channels as db_list_channels,
    list_tokens as db_list_tokens, mint_token as db_mint_token, open_database,
    revoke_token as db_revoke_token, ChannelRecord, TokenRecord,
};
use crate::protocol::{
    health_response, AdminLoginRequest, AdminLoginResponse, AuthenticatedTokenResponse,
    ChannelMode, ChannelResponse, CreateChannelRequest, ErrorResponse, HealthResponse,
    MintTokenRequest, MintTokenResponse, ProtocolError, TokenKind, TokenMetadata,
};
use crate::ServiceConfig;
use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::net::TcpListener;

const ADMIN_SESSION_COOKIE: &str = "ap_admin_session";
const ADMIN_SESSION_SECONDS: u64 = 60 * 60;

#[derive(Clone)]
pub struct AppState {
    database_path: Arc<std::path::PathBuf>,
    admin_secret: Arc<String>,
    admin_sessions: Arc<std::sync::Mutex<HashMap<String, SystemTime>>>,
}

pub fn build_router(config: ServiceConfig) -> anyhow::Result<Router> {
    let connection = open_database(&config.database_path)?;
    drop(connection);

    let state = AppState {
        database_path: Arc::new(config.database_path),
        admin_secret: Arc::new(config.admin_secret),
        admin_sessions: Arc::new(std::sync::Mutex::new(HashMap::new())),
    };

    Ok(Router::new()
        .route("/health", get(health))
        .route("/admin", get(admin_page))
        .route("/admin/login", post(admin_login))
        .route(
            "/admin/api/channels",
            get(list_channels).post(create_channel),
        )
        .route("/admin/api/tokens", get(list_tokens).post(mint_token))
        .route("/admin/api/tokens/{token_id}/revoke", post(revoke_token))
        .route("/api/auth/me", get(authenticated_token))
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

async fn admin_page(State(state): State<AppState>, headers: HeaderMap) -> Html<&'static str> {
    if require_admin_session(&state, &headers).is_ok() {
        Html(ADMIN_DASHBOARD_HTML)
    } else {
        Html(ADMIN_LOGIN_HTML)
    }
}

async fn admin_login(
    State(state): State<AppState>,
    Json(payload): Json<AdminLoginRequest>,
) -> Response {
    if payload.admin_secret != *state.admin_secret {
        return json_error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Invalid admin secret",
        );
    }

    let session_id = match make_session_id() {
        Ok(session_id) => session_id,
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Internal error",
            );
        }
    };
    let expires_at = SystemTime::now() + Duration::from_secs(ADMIN_SESSION_SECONDS);
    state
        .admin_sessions
        .lock()
        .expect("admin session lock poisoned")
        .insert(session_id.clone(), expires_at);

    let cookie = format!(
        "{ADMIN_SESSION_COOKIE}={session_id}; HttpOnly; SameSite=Lax; Max-Age={ADMIN_SESSION_SECONDS}; Path=/"
    );
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(AdminLoginResponse {
            ok: true,
            expires_in_seconds: ADMIN_SESSION_SECONDS,
        }),
    )
        .into_response()
}

async fn create_channel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateChannelRequest>,
) -> Response {
    if let Err(response) = require_admin_session(&state, &headers) {
        return response;
    }

    match db_create_channel(
        &state.database_path,
        payload.name.as_str(),
        channel_mode_str(&payload.mode),
    ) {
        Ok(channel) => (StatusCode::CREATED, Json(channel_response(channel))).into_response(),
        Err(_) => json_error(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Invalid channel request",
        ),
    }
}

async fn list_channels(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_admin_session(&state, &headers) {
        return response;
    }

    match db_list_channels(&state.database_path) {
        Ok(channels) => {
            let channels = channels
                .into_iter()
                .map(channel_response)
                .collect::<Vec<_>>();
            Json(channels).into_response()
        }
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Internal error",
        ),
    }
}

async fn mint_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<MintTokenRequest>,
) -> Response {
    if let Err(response) = require_admin_session(&state, &headers) {
        return response;
    }

    match db_mint_token(
        &state.database_path,
        token_kind_str(&payload.kind),
        payload.owner_label.as_str(),
    ) {
        Ok((metadata, token)) => (
            StatusCode::CREATED,
            Json(MintTokenResponse {
                token,
                metadata: token_metadata(metadata),
            }),
        )
            .into_response(),
        Err(_) => json_error(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Invalid token request",
        ),
    }
}

async fn list_tokens(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_admin_session(&state, &headers) {
        return response;
    }

    match db_list_tokens(&state.database_path) {
        Ok(tokens) => {
            let tokens = tokens.into_iter().map(token_metadata).collect::<Vec<_>>();
            Json(tokens).into_response()
        }
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Internal error",
        ),
    }
}

async fn revoke_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(token_id): AxumPath<String>,
) -> Response {
    if let Err(response) = require_admin_session(&state, &headers) {
        return response;
    }

    match db_revoke_token(&state.database_path, &token_id) {
        Ok(Some(token)) => Json(token_metadata(token)).into_response(),
        Ok(None) => json_error(StatusCode::NOT_FOUND, "not_found", "Token not found"),
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Internal error",
        ),
    }
}

async fn authenticated_token(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(secret) = bearer_token(&headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized", "Unauthorized");
    };

    match authenticate_token(&state.database_path, secret) {
        Ok(Some(token)) => Json(AuthenticatedTokenResponse {
            token: token_metadata(token),
        })
        .into_response(),
        Ok(None) => json_error(StatusCode::UNAUTHORIZED, "unauthorized", "Unauthorized"),
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Internal error",
        ),
    }
}

fn require_admin_session(state: &AppState, headers: &HeaderMap) -> Result<(), Response> {
    let Some(session_id) = cookie_value(headers, ADMIN_SESSION_COOKIE) else {
        return Err(json_error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Admin session required",
        ));
    };

    let now = SystemTime::now();
    let mut sessions = state
        .admin_sessions
        .lock()
        .expect("admin session lock poisoned");
    sessions.retain(|_, expires_at| *expires_at > now);

    if sessions.contains_key(session_id) {
        Ok(())
    } else {
        Err(json_error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Admin session required",
        ))
    }
}

fn cookie_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        (key == name).then_some(value)
    })
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    value.strip_prefix("Bearer ")
}

fn json_error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(ErrorResponse {
            error: ProtocolError {
                code: code.to_string(),
                message: message.to_string(),
            },
        }),
    )
        .into_response()
}

fn channel_response(record: ChannelRecord) -> ChannelResponse {
    ChannelResponse {
        id: record.id,
        name: record.name,
        mode: match record.mode.as_str() {
            "party" => ChannelMode::Party,
            _ => ChannelMode::Normal,
        },
        created_at: record.created_at,
    }
}

fn token_metadata(record: TokenRecord) -> TokenMetadata {
    TokenMetadata {
        id: record.id,
        kind: match record.kind.as_str() {
            "agent" => TokenKind::Agent,
            _ => TokenKind::Human,
        },
        owner_label: record.owner_label,
        created_at: record.created_at,
        revoked_at: record.revoked_at,
    }
}

fn channel_mode_str(mode: &ChannelMode) -> &'static str {
    match mode {
        ChannelMode::Normal => "normal",
        ChannelMode::Party => "party",
    }
}

fn token_kind_str(kind: &TokenKind) -> &'static str {
    match kind {
        TokenKind::Human => "human",
        TokenKind::Agent => "agent",
    }
}

fn make_session_id() -> anyhow::Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|err| anyhow::anyhow!("generate admin session: {err}"))?;
    Ok(format!("adm_{}", hex(&bytes)))
}

fn hex(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(TABLE[(byte >> 4) as usize] as char);
        out.push(TABLE[(byte & 0x0f) as usize] as char);
    }
    out
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

const ADMIN_LOGIN_HTML: &str = r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentParty Admin</title>
</head>
<body>
  <main>
    <h1>AgentParty Admin</h1>
    <form id="login-form">
      <label>Admin secret <input name="admin_secret" type="password" autocomplete="current-password" autofocus></label>
      <button type="submit">Sign in</button>
    </form>
  </main>
  <script>
    document.querySelector("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const admin_secret = new FormData(event.currentTarget).get("admin_secret");
      const response = await fetch("/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ admin_secret })
      });
      if (response.ok) location.reload();
      else alert("Invalid admin secret");
    });
  </script>
</body>
</html>"##;

const ADMIN_DASHBOARD_HTML: &str = r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentParty Admin</title>
</head>
<body>
  <main>
    <h1>AgentParty Admin</h1>
    <section>
      <h2>Create channel</h2>
      <form id="channel-form">
        <input name="name" placeholder="Channel name">
        <select name="mode">
          <option value="normal">Normal</option>
          <option value="party">Party</option>
        </select>
        <button type="submit">Create</button>
      </form>
      <ul id="channel-list"></ul>
    </section>
    <section>
      <h2>Mint token</h2>
      <form id="token-form">
        <input name="owner_label" placeholder="Owner label">
        <select name="kind">
          <option value="human">Human</option>
          <option value="agent">Agent</option>
        </select>
        <button type="submit">Mint</button>
      </form>
      <pre id="minted-token"></pre>
      <ul id="token-list"></ul>
    </section>
  </main>
  <script>
    async function refreshChannels() {
      const response = await fetch("/admin/api/channels");
      const channels = response.ok ? await response.json() : [];
      document.querySelector("#channel-list").replaceChildren(...channels.map((channel) => {
        const item = document.createElement("li");
        item.textContent = `${channel.name} (${channel.mode})`;
        return item;
      }));
    }

    async function refreshTokens() {
      const response = await fetch("/admin/api/tokens");
      const tokens = response.ok ? await response.json() : [];
      document.querySelector("#token-list").replaceChildren(...tokens.map((token) => {
        const item = document.createElement("li");
        const state = token.revoked_at === null ? "active" : "revoked";
        item.textContent = `${token.owner_label} (${token.kind}, ${state}) `;
        if (token.revoked_at === null) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Revoke";
          button.addEventListener("click", async () => {
            await fetch(`/admin/api/tokens/${token.id}/revoke`, { method: "POST" });
            await refreshTokens();
          });
          item.append(button);
        }
        return item;
      }));
    }

    document.querySelector("#channel-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      await fetch("/admin/api/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      event.currentTarget.reset();
      await refreshChannels();
    });
    document.querySelector("#token-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch("/admin/api/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const body = await response.json();
      document.querySelector("#minted-token").textContent = response.ok ? body.token : "";
      event.currentTarget.reset();
      await refreshTokens();
    });
    refreshChannels();
    refreshTokens();
  </script>
</body>
</html>"##;
