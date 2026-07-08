use crate::db::{
    append_message_event, append_status_event, archive_channel as db_archive_channel,
    authenticate_token, channel_by_id, channel_loop_guard, create_channel as db_create_channel,
    last_channel_sequence, list_channel_events, list_channels as db_list_channels,
    list_tokens as db_list_tokens, mint_token as db_mint_token, open_database,
    revoke_token as db_revoke_token, ChannelRecord, ChannelWriteError, TokenRecord,
};
use crate::protocol::{
    health_response, AdminLoginRequest, AdminLoginResponse, AuthenticatedTokenResponse,
    ChannelEvent, ChannelHistoryResponse, ChannelMode, ChannelResponse, CreateChannelRequest,
    ErrorResponse, HealthResponse, MintTokenRequest, MintTokenResponse, PostMessageRequest,
    PostStatusRequest, PresenceState, PresenceUpdate, ProtocolError, SentAckFrame, TokenKind,
    TokenMetadata, WebSocketClientFrame, WebSocketFrame, WebSocketWelcomeFrame,
};
use crate::ServiceConfig;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::net::TcpListener;
use tokio::sync::broadcast;

const ADMIN_SESSION_COOKIE: &str = "ap_admin_session";
const ADMIN_SESSION_SECONDS: u64 = 60 * 60;

#[derive(Clone)]
pub struct AppState {
    database_path: Arc<std::path::PathBuf>,
    admin_secret: Arc<String>,
    admin_sessions: Arc<std::sync::Mutex<HashMap<String, SystemTime>>>,
    events: broadcast::Sender<WebSocketFrame>,
}

pub fn build_router(config: ServiceConfig) -> anyhow::Result<Router> {
    let connection = open_database(&config.database_path)?;
    drop(connection);

    let state = AppState {
        database_path: Arc::new(config.database_path),
        admin_secret: Arc::new(config.admin_secret),
        admin_sessions: Arc::new(std::sync::Mutex::new(HashMap::new())),
        events: broadcast::channel(256).0,
    };

    Ok(Router::new()
        .route("/health", get(health))
        .route("/admin", get(admin_page))
        .route("/admin/login", post(admin_login))
        .route(
            "/admin/api/channels",
            get(list_channels).post(create_channel),
        )
        .route(
            "/admin/api/channels/{channel_id}/archive",
            post(archive_channel),
        )
        .route("/admin/api/tokens", get(list_tokens).post(mint_token))
        .route("/admin/api/tokens/{token_id}/revoke", post(revoke_token))
        .route("/api/auth/me", get(authenticated_token))
        .route(
            "/api/channels/{channel_id}/messages",
            post(post_channel_message),
        )
        .route(
            "/api/channels/{channel_id}/status",
            post(post_channel_status),
        )
        .route("/api/channels/{channel_id}/events", get(channel_history))
        .route("/api/channels/{channel_id}/ws", get(channel_websocket))
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
        Ok(channel) => match channel_response(&state.database_path, channel) {
            Ok(channel) => (StatusCode::CREATED, Json(channel)).into_response(),
            Err(_) => json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Internal error",
            ),
        },
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
                .map(|channel| channel_response(&state.database_path, channel))
                .collect::<anyhow::Result<Vec<_>>>();
            match channels {
                Ok(channels) => Json(channels).into_response(),
                Err(_) => json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "Internal error",
                ),
            }
        }
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Internal error",
        ),
    }
}

async fn archive_channel(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(channel_id): AxumPath<String>,
) -> Response {
    if let Err(response) = require_admin_session(&state, &headers) {
        return response;
    }

    match db_archive_channel(&state.database_path, &channel_id) {
        Ok(Some(channel)) => match channel_response(&state.database_path, channel) {
            Ok(channel) => Json(channel).into_response(),
            Err(_) => json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Internal error",
            ),
        },
        Ok(None) => json_error(StatusCode::NOT_FOUND, "not_found", "Channel not found"),
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

async fn post_channel_message(
    State(state): State<AppState>,
    AxumPath(channel_id): AxumPath<String>,
    headers: HeaderMap,
    Json(payload): Json<PostMessageRequest>,
) -> Response {
    let Some(token) = authenticated_bearer(&state, &headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized", "Unauthorized");
    };

    match append_message_event(
        &state.database_path,
        &channel_id,
        token_metadata(token),
        &payload.body,
        payload.mentions,
        payload.reply_to_message_id,
    ) {
        Ok(ChannelEvent::Message(message)) => {
            let _ = state.events.send(WebSocketFrame::Message(message.clone()));
            (StatusCode::CREATED, Json(message)).into_response()
        }
        Ok(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Internal error",
        ),
        Err(err) => write_error_response(err),
    }
}

async fn post_channel_status(
    State(state): State<AppState>,
    AxumPath(channel_id): AxumPath<String>,
    headers: HeaderMap,
    Json(payload): Json<PostStatusRequest>,
) -> Response {
    let Some(token) = authenticated_bearer(&state, &headers) else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized", "Unauthorized");
    };

    match append_status_event(
        &state.database_path,
        &channel_id,
        token_metadata(token),
        payload.state,
        payload.scope,
    ) {
        Ok(ChannelEvent::Status(status)) => {
            let _ = state.events.send(WebSocketFrame::Status(status.clone()));
            (StatusCode::CREATED, Json(status)).into_response()
        }
        Ok(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "Internal error",
        ),
        Err(err) => write_error_response(err),
    }
}

async fn channel_history(
    State(state): State<AppState>,
    AxumPath(channel_id): AxumPath<String>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if authenticated_bearer(&state, &headers).is_none() {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized", "Unauthorized");
    }

    let after_sequence = query
        .get("after_sequence")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    match (
        list_channel_events(&state.database_path, &channel_id, after_sequence),
        last_channel_sequence(&state.database_path, &channel_id),
        channel_loop_guard(&state.database_path, &channel_id),
    ) {
        (Ok(events), Ok(last_sequence), Ok(loop_guard)) => Json(ChannelHistoryResponse {
            events,
            last_sequence,
            loop_guard,
        })
        .into_response(),
        _ => json_error(StatusCode::NOT_FOUND, "not_found", "Channel not found"),
    }
}

async fn channel_websocket(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    AxumPath(channel_id): AxumPath<String>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Some(token) = websocket_token(&state, &headers, &query) else {
        return json_error(StatusCode::UNAUTHORIZED, "unauthorized", "Unauthorized");
    };
    let Ok(Some(channel)) = channel_by_id(&state.database_path, &channel_id) else {
        return json_error(StatusCode::NOT_FOUND, "not_found", "Channel not found");
    };

    let after_sequence = query
        .get("after_sequence")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);

    ws.on_upgrade(move |socket| websocket_session(socket, state, channel, token, after_sequence))
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

fn authenticated_bearer(state: &AppState, headers: &HeaderMap) -> Option<TokenRecord> {
    let secret = bearer_token(headers)?;
    authenticate_token(&state.database_path, secret)
        .ok()
        .flatten()
}

fn websocket_token(
    state: &AppState,
    headers: &HeaderMap,
    query: &HashMap<String, String>,
) -> Option<TokenRecord> {
    if let Some(token) = authenticated_bearer(state, headers) {
        return Some(token);
    }
    let secret = query.get("token")?;
    authenticate_token(&state.database_path, secret)
        .ok()
        .flatten()
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

fn write_error_response(err: anyhow::Error) -> Response {
    if let Some(err) = err.downcast_ref::<ChannelWriteError>() {
        return json_error(StatusCode::CONFLICT, err.code(), err.message());
    }
    json_error(StatusCode::BAD_REQUEST, "bad_request", "Invalid request")
}

fn write_protocol_error(err: anyhow::Error) -> ProtocolError {
    if let Some(err) = err.downcast_ref::<ChannelWriteError>() {
        return ProtocolError {
            code: err.code().to_string(),
            message: err.message().to_string(),
        };
    }
    ProtocolError {
        code: "bad_request".to_string(),
        message: "Invalid request".to_string(),
    }
}

fn channel_response(
    database_path: &std::path::Path,
    record: ChannelRecord,
) -> anyhow::Result<ChannelResponse> {
    let loop_guard = channel_loop_guard(database_path, &record.id)?;
    Ok(ChannelResponse {
        id: record.id,
        name: record.name,
        mode: match record.mode.as_str() {
            "party" => ChannelMode::Party,
            _ => ChannelMode::Normal,
        },
        created_at: record.created_at,
        archived_at: record.archived_at,
        loop_guard,
    })
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

fn frame_channel_id(frame: &WebSocketFrame) -> Option<&str> {
    match frame {
        WebSocketFrame::Welcome(frame) => Some(&frame.channel.id),
        WebSocketFrame::Message(message) => Some(&message.channel_id),
        WebSocketFrame::Status(status) => Some(&status.channel_id),
        WebSocketFrame::Presence(presence) => Some(&presence.channel_id),
        WebSocketFrame::Sent(sent) => Some(&sent.channel_id),
        WebSocketFrame::Error(_) => None,
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

async fn websocket_session(
    mut socket: WebSocket,
    state: AppState,
    channel: ChannelRecord,
    token: TokenRecord,
    after_sequence: i64,
) {
    let Ok(channel) = channel_response(&state.database_path, channel) else {
        return;
    };
    let self_token = token_metadata(token);
    let mut receiver = state.events.subscribe();

    let last_sequence = last_channel_sequence(&state.database_path, &channel.id).unwrap_or(0);
    let welcome = WebSocketFrame::Welcome(WebSocketWelcomeFrame {
        channel: channel.clone(),
        self_token: self_token.clone(),
        participants: Vec::new(),
        last_sequence,
        protocol_version: 1,
    });
    if send_ws_frame(&mut socket, &welcome).await.is_err() {
        return;
    }

    if let Ok(events) = list_channel_events(&state.database_path, &channel.id, after_sequence) {
        for event in events {
            let frame = frame_from_event(event);
            if send_ws_frame(&mut socket, &frame).await.is_err() {
                return;
            }
        }
    }

    let online = WebSocketFrame::Presence(PresenceUpdate {
        channel_id: channel.id.clone(),
        participant: self_token.clone(),
        state: PresenceState::Online,
    });
    let _ = state.events.send(online);

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if handle_client_ws_frame(&mut socket, &state, &channel.id, &self_token, &text).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            broadcast = receiver.recv() => {
                match broadcast {
                    Ok(frame) => {
                        if frame_channel_id(&frame) == Some(channel.id.as_str())
                            && send_ws_frame(&mut socket, &frame).await.is_err()
                        {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let _ = send_ws_frame(
                            &mut socket,
                            &WebSocketFrame::Error(ProtocolError {
                                code: "history_required".to_string(),
                                message: "Reconnect with after_sequence to catch up".to_string(),
                            }),
                        )
                        .await;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    let offline = WebSocketFrame::Presence(PresenceUpdate {
        channel_id: channel.id,
        participant: self_token,
        state: PresenceState::Offline,
    });
    let _ = state.events.send(offline);
}

async fn handle_client_ws_frame(
    socket: &mut WebSocket,
    state: &AppState,
    channel_id: &str,
    self_token: &TokenMetadata,
    text: &str,
) -> anyhow::Result<()> {
    let frame: WebSocketClientFrame = serde_json::from_str(text)?;
    let event = match frame {
        WebSocketClientFrame::Message(payload) => match append_message_event(
            &state.database_path,
            channel_id,
            self_token.clone(),
            &payload.body,
            payload.mentions,
            payload.reply_to_message_id,
        ) {
            Ok(event) => event,
            Err(err) => {
                send_ws_frame(socket, &WebSocketFrame::Error(write_protocol_error(err))).await?;
                return Ok(());
            }
        },
        WebSocketClientFrame::Status(payload) => match append_status_event(
            &state.database_path,
            channel_id,
            self_token.clone(),
            payload.state,
            payload.scope,
        ) {
            Ok(event) => event,
            Err(err) => {
                send_ws_frame(socket, &WebSocketFrame::Error(write_protocol_error(err))).await?;
                return Ok(());
            }
        },
    };
    let frame = frame_from_event(event);
    let sequence = frame_sequence(&frame).unwrap_or(0);
    let _ = state.events.send(frame);
    send_ws_frame(
        socket,
        &WebSocketFrame::Sent(SentAckFrame {
            channel_id: channel_id.to_string(),
            sequence,
        }),
    )
    .await?;
    Ok(())
}

fn frame_from_event(event: ChannelEvent) -> WebSocketFrame {
    match event {
        ChannelEvent::Message(message) => WebSocketFrame::Message(message),
        ChannelEvent::Status(status) => WebSocketFrame::Status(status),
        ChannelEvent::Presence(presence) => WebSocketFrame::Presence(presence),
    }
}

fn frame_sequence(frame: &WebSocketFrame) -> Option<i64> {
    match frame {
        WebSocketFrame::Message(message) => Some(message.sequence),
        WebSocketFrame::Status(status) => Some(status.sequence),
        WebSocketFrame::Sent(sent) => Some(sent.sequence),
        _ => None,
    }
}

async fn send_ws_frame(socket: &mut WebSocket, frame: &WebSocketFrame) -> anyhow::Result<()> {
    socket
        .send(Message::Text(serde_json::to_string(frame)?.into()))
        .await?;
    Ok(())
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
        const state = channel.archived_at === null ? "active" : "archived";
        item.textContent = `${channel.name} (${channel.mode}, ${state}, guard ${channel.loop_guard.consecutive_agent_messages}/${channel.loop_guard.threshold}) `;
        if (channel.archived_at === null) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Archive";
          button.addEventListener("click", async () => {
            await fetch(`/admin/api/channels/${channel.id}/archive`, { method: "POST" });
            await refreshChannels();
          });
          item.append(button);
        }
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
