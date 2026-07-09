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
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware;
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, options, post};
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
        .route("/admin/login", post(admin_login).options(cors_preflight))
        .route(
            "/admin/api/channels",
            get(list_channels)
                .post(create_channel)
                .options(cors_preflight),
        )
        .route(
            "/admin/api/channels/{channel_id}/archive",
            post(archive_channel).options(cors_preflight),
        )
        .route(
            "/admin/api/tokens",
            get(list_tokens).post(mint_token).options(cors_preflight),
        )
        .route(
            "/admin/api/tokens/{token_id}/revoke",
            post(revoke_token).options(cors_preflight),
        )
        .route(
            "/api/auth/me",
            get(authenticated_token).options(cors_preflight),
        )
        .route(
            "/api/channels/{channel_id}/messages",
            post(post_channel_message).options(cors_preflight),
        )
        .route(
            "/api/channels/{channel_id}/status",
            post(post_channel_status).options(cors_preflight),
        )
        .route(
            "/api/channels/{channel_id}/events",
            get(channel_history).options(cors_preflight),
        )
        .route("/api/channels/{channel_id}/ws", get(channel_websocket))
        .route("/{*path}", options(cors_preflight))
        .layer(middleware::map_response(add_cors_headers))
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

async fn cors_preflight() -> Response {
    StatusCode::NO_CONTENT.into_response()
}

async fn add_cors_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("authorization,content-type"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET,POST,OPTIONS"),
    );
    response
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
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #17202a;
      --muted: #657286;
      --line: #d8dee8;
      --accent: #116a5c;
      --accent-strong: #0b4f45;
      --danger: #b42318;
      --focus: #7cc7bc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    main {
      width: min(460px, calc(100vw - 32px));
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 18px 45px rgba(23, 32, 42, 0.08);
    }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.15; }
    p { margin: 0 0 22px; color: var(--muted); }
    label { display: block; margin-bottom: 16px; font-weight: 650; }
    input {
      width: 100%;
      margin-top: 7px;
      padding: 11px 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
    }
    input:focus {
      outline: 3px solid var(--focus);
      border-color: var(--accent);
    }
    button {
      width: 100%;
      border: 0;
      border-radius: 6px;
      padding: 11px 14px;
      background: var(--accent);
      color: white;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: var(--accent-strong); }
    #login-error {
      min-height: 22px;
      margin-top: 14px;
      color: var(--danger);
      font-weight: 650;
    }
  </style>
</head>
<body>
  <main>
    <h1>AgentParty Admin</h1>
    <p>Sign in with the admin secret configured for this main service. After login you can create channels and mint desktop tokens.</p>
    <form id="login-form">
      <label>Admin secret <input name="admin_secret" type="password" autocomplete="current-password" autofocus></label>
      <button type="submit">Sign in</button>
      <div id="login-error" role="status" aria-live="polite"></div>
    </form>
  </main>
  <script>
    document.querySelector("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = document.querySelector("#login-error");
      error.textContent = "";
      const admin_secret = new FormData(event.currentTarget).get("admin_secret");
      const response = await fetch("/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ admin_secret })
      });
      if (response.ok) location.reload();
      else error.textContent = "Invalid admin secret.";
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
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #17202a;
      --muted: #657286;
      --line: #d8dee8;
      --line-strong: #bac4d2;
      --accent: #116a5c;
      --accent-strong: #0b4f45;
      --danger: #b42318;
      --warn-bg: #fff7e6;
      --warn-line: #f2c46d;
      --ok-bg: #eaf7f3;
      --focus: #7cc7bc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 40px;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 22px;
    }
    h1 { margin: 0 0 6px; font-size: 30px; line-height: 1.15; }
    h2 { margin: 0 0 6px; font-size: 18px; }
    h3 { margin: 0 0 10px; font-size: 14px; color: var(--muted); text-transform: uppercase; }
    p { margin: 0; color: var(--muted); }
    .status {
      min-width: 210px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--muted);
      font-size: 14px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(300px, 0.95fr) minmax(360px, 1.2fr) minmax(300px, 0.95fr);
      gap: 16px;
      align-items: start;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      min-width: 0;
    }
    form { display: grid; gap: 12px; margin-top: 16px; }
    label { display: grid; gap: 6px; font-weight: 650; }
    input, select {
      width: 100%;
      padding: 10px 11px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: white;
      color: var(--ink);
      font: inherit;
    }
    input:focus, select:focus, button:focus {
      outline: 3px solid var(--focus);
      outline-offset: 1px;
    }
    button {
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 10px 12px;
      background: var(--accent);
      color: white;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover { background: var(--accent-strong); }
    button.secondary {
      background: white;
      color: var(--ink);
      border-color: var(--line-strong);
    }
    button.secondary:hover { background: #eef2f6; }
    button.danger {
      background: white;
      color: var(--danger);
      border-color: #f0b8b2;
    }
    button.danger:hover { background: #fff1ef; }
    .list {
      display: grid;
      gap: 10px;
      margin-top: 16px;
    }
    .item {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fbfcfd;
    }
    .item-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      margin-bottom: 8px;
    }
    .name { font-weight: 750; overflow-wrap: anywhere; }
    .meta {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: white;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
      text-transform: uppercase;
    }
    .badge.active { background: var(--ok-bg); color: var(--accent-strong); border-color: #9bd3c8; }
    .badge.revoked, .badge.archived { color: var(--danger); border-color: #f0b8b2; background: #fff1ef; }
    .token-result {
      display: none;
      margin-top: 16px;
      border: 1px solid var(--warn-line);
      background: var(--warn-bg);
      border-radius: 8px;
      padding: 12px;
    }
    .token-result.visible { display: block; }
    .token-value {
      margin-top: 10px;
      padding: 10px;
      border: 1px solid var(--warn-line);
      border-radius: 6px;
      background: white;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .empty {
      margin-top: 16px;
      padding: 16px;
      border: 1px dashed var(--line-strong);
      border-radius: 8px;
      color: var(--muted);
      background: #fbfcfd;
    }
    .copy-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
      margin-top: 10px;
    }
    @media (max-width: 980px) {
      header { display: block; }
      .status { margin-top: 14px; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>AgentParty Admin</h1>
        <p>Create channels and issue tokens for AgentParty Workbench clients.</p>
      </div>
      <div class="status" id="service-status">Loading service state...</div>
    </header>
    <div class="grid">
    <section aria-labelledby="create-channel-title">
      <h2 id="create-channel-title">Create Channel</h2>
      <p>Use a normal channel for directed tests, or party mode for multi-agent rooms.</p>
      <form id="channel-form">
        <label>Channel name <input name="name" placeholder="Example: Local AgentParty" required></label>
        <label>Mode
          <select name="mode">
            <option value="normal">Normal</option>
            <option value="party">Party</option>
          </select>
        </label>
        <button type="submit">Create</button>
      </form>
    </section>
    <section aria-labelledby="channels-title">
      <h2 id="channels-title">Channels</h2>
      <p>Copy a channel ID into Workbench when creating a server profile.</p>
      <div id="channel-list" class="list"></div>
    </section>
    <section aria-labelledby="mint-token-title">
      <h2 id="mint-token-title">Mint Token</h2>
      <p>Mint a human token for an operator or an agent token for a local runner.</p>
      <form id="token-form">
        <label>Owner label <input name="owner_label" placeholder="Example: Alice Workbench" required></label>
        <label>Token kind
          <select name="kind">
            <option value="human">Human</option>
            <option value="agent">Agent</option>
          </select>
        </label>
        <button type="submit">Mint</button>
      </form>
      <div id="minted-token" class="token-result" aria-live="polite"></div>
    </section>
    <section aria-labelledby="tokens-title">
      <h2 id="tokens-title">Tokens</h2>
      <p>Token secrets are shown only once when minted. The list only shows metadata.</p>
      <div id="token-list" class="list"></div>
    </section>
    </div>
  </main>
  <script>
    const status = document.querySelector("#service-status");

    function setStatus(message) {
      status.textContent = message;
    }

    function formatTime(value) {
      if (value === null || value === undefined) return "never";
      return new Date(value * 1000).toLocaleString();
    }

    function emptyState(text) {
      const node = document.createElement("div");
      node.className = "empty";
      node.textContent = text;
      return node;
    }

    function copyButton(value, label = "Copy") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = label;
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(value);
        button.textContent = "Copied";
        window.setTimeout(() => { button.textContent = label; }, 1200);
      });
      return button;
    }

    async function requestJson(url, options = {}) {
      const response = await fetch(url, options);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed: ${response.status}`);
      }
      return response.json();
    }

    async function refreshChannels() {
      const channels = await requestJson("/admin/api/channels");
      const list = document.querySelector("#channel-list");
      if (channels.length === 0) {
        list.replaceChildren(emptyState("No channels yet."));
        return;
      }
      list.replaceChildren(...channels.map((channel) => {
        const item = document.createElement("article");
        item.className = "item";
        const state = channel.archived_at === null ? "active" : "archived";
        item.innerHTML = `
          <div class="item-head">
            <div class="name"></div>
            <span class="badge ${state}">${state}</span>
          </div>
          <div class="meta">
            <div><strong>ID:</strong> <span class="channel-id"></span></div>
            <div><strong>Mode:</strong> ${channel.mode}</div>
            <div><strong>Loop guard:</strong> ${channel.loop_guard.consecutive_agent_messages}/${channel.loop_guard.threshold}</div>
            <div><strong>Created:</strong> ${formatTime(channel.created_at)}</div>
          </div>
          <div class="actions"></div>
        `;
        item.querySelector(".name").textContent = channel.name;
        item.querySelector(".channel-id").textContent = channel.id;
        const actions = item.querySelector(".actions");
        actions.append(copyButton(channel.id, "Copy ID"));
        if (channel.archived_at === null) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "danger";
          button.textContent = "Archive";
          button.addEventListener("click", async () => {
            await requestJson(`/admin/api/channels/${channel.id}/archive`, { method: "POST" });
            await refreshChannels();
            setStatus(`Archived channel ${channel.name}.`);
          });
          actions.append(button);
        }
        return item;
      }));
    }

    async function refreshTokens() {
      const tokens = await requestJson("/admin/api/tokens");
      const list = document.querySelector("#token-list");
      if (tokens.length === 0) {
        list.replaceChildren(emptyState("No tokens yet."));
        return;
      }
      list.replaceChildren(...tokens.map((token) => {
        const item = document.createElement("article");
        item.className = "item";
        const state = token.revoked_at === null ? "active" : "revoked";
        item.innerHTML = `
          <div class="item-head">
            <div class="name"></div>
            <span class="badge ${state}">${state}</span>
          </div>
          <div class="meta">
            <div><strong>ID:</strong> <span class="token-id"></span></div>
            <div><strong>Kind:</strong> ${token.kind}</div>
            <div><strong>Created:</strong> ${formatTime(token.created_at)}</div>
            <div><strong>Revoked:</strong> ${formatTime(token.revoked_at)}</div>
          </div>
          <div class="actions"></div>
        `;
        item.querySelector(".name").textContent = token.owner_label;
        item.querySelector(".token-id").textContent = token.id;
        const actions = item.querySelector(".actions");
        if (token.revoked_at === null) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "danger";
          button.textContent = "Revoke";
          button.addEventListener("click", async () => {
            await requestJson(`/admin/api/tokens/${token.id}/revoke`, { method: "POST" });
            await refreshTokens();
            setStatus(`Revoked token for ${token.owner_label}.`);
          });
          actions.append(button);
        }
        return item;
      }));
    }

    document.querySelector("#channel-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const channel = await requestJson("/admin/api/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      event.currentTarget.reset();
      await refreshChannels();
      setStatus(`Created channel ${channel.name}. Copy its ID into Workbench.`);
    });
    document.querySelector("#token-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const body = await requestJson("/admin/api/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const result = document.querySelector("#minted-token");
      result.classList.add("visible");
      result.replaceChildren();
      const title = document.createElement("strong");
      title.textContent = "Copy this token now. It will not be shown again.";
      const value = document.createElement("div");
      value.className = "token-value";
      value.textContent = body.token;
      const row = document.createElement("div");
      row.className = "copy-row";
      const hint = document.createElement("span");
      hint.textContent = `${body.metadata.kind} token for ${body.metadata.owner_label}`;
      row.append(hint, copyButton(body.token, "Copy token"));
      result.append(title, value, row);
      event.currentTarget.reset();
      await refreshTokens();
      setStatus(`Minted ${body.metadata.kind} token for ${body.metadata.owner_label}.`);
    });
    Promise.all([refreshChannels(), refreshTokens()])
      .then(() => setStatus("Ready. Create a channel, mint a token, then connect Workbench."))
      .catch((error) => setStatus(error.message));
  </script>
</body>
</html>"##;
