use crate::protocol::{
    ChannelEvent, ChannelMessage, ParticipantStatusState, StatusUpdate, TokenMetadata,
};
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChannelRecord {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TokenRecord {
    pub id: String,
    pub kind: String,
    pub owner_label: String,
    pub created_at: i64,
    pub revoked_at: Option<i64>,
}

pub fn open_database(path: &Path) -> anyhow::Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let connection = Connection::open(path)?;
    migrate(&connection)?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> anyhow::Result<()> {
    connection.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS service_metadata (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS channels (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('normal', 'party')),
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tokens (
            id TEXT PRIMARY KEY NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
            owner_label TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL,
            revoked_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS channel_events (
            id TEXT PRIMARY KEY NOT NULL,
            channel_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('message', 'status', 'presence')),
            payload_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (channel_id) REFERENCES channels(id),
            UNIQUE(channel_id, sequence)
        );

        INSERT OR IGNORE INTO service_metadata (key, value)
        VALUES ('schema_version', '1');
        "#,
    )?;

    Ok(())
}

pub fn create_channel(path: &Path, name: &str, mode: &str) -> anyhow::Result<ChannelRecord> {
    let name = name.trim();
    if name.is_empty() {
        anyhow::bail!("channel name is required");
    }
    if !matches!(mode, "normal" | "party") {
        anyhow::bail!("channel mode must be normal or party");
    }

    let connection = open_database(path)?;
    let record = ChannelRecord {
        id: make_id("chan"),
        name: name.to_string(),
        mode: mode.to_string(),
        created_at: unix_now(),
    };
    connection.execute(
        "INSERT INTO channels (id, name, mode, created_at) VALUES (?1, ?2, ?3, ?4)",
        (&record.id, &record.name, &record.mode, record.created_at),
    )?;
    Ok(record)
}

pub fn list_channels(path: &Path) -> anyhow::Result<Vec<ChannelRecord>> {
    let connection = open_database(path)?;
    let mut statement = connection
        .prepare("SELECT id, name, mode, created_at FROM channels ORDER BY created_at ASC")?;
    let rows = statement.query_map([], |row| {
        Ok(ChannelRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            mode: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn channel_by_id(path: &Path, channel_id: &str) -> anyhow::Result<Option<ChannelRecord>> {
    let connection = open_database(path)?;
    let mut statement =
        connection.prepare("SELECT id, name, mode, created_at FROM channels WHERE id = ?1")?;
    let mut rows = statement.query([channel_id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };

    Ok(Some(ChannelRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        mode: row.get(2)?,
        created_at: row.get(3)?,
    }))
}

pub fn mint_token(
    path: &Path,
    kind: &str,
    owner_label: &str,
) -> anyhow::Result<(TokenRecord, String)> {
    let owner_label = owner_label.trim();
    if owner_label.is_empty() {
        anyhow::bail!("owner label is required");
    }
    if !matches!(kind, "human" | "agent") {
        anyhow::bail!("token kind must be human or agent");
    }

    let connection = open_database(path)?;
    let secret = make_token_secret()?;
    let record = TokenRecord {
        id: make_id("tok"),
        kind: kind.to_string(),
        owner_label: owner_label.to_string(),
        created_at: unix_now(),
        revoked_at: None,
    };
    connection.execute(
        "INSERT INTO tokens (id, kind, owner_label, token_hash, created_at, revoked_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
        (
            &record.id,
            &record.kind,
            &record.owner_label,
            token_hash(&secret),
            record.created_at,
        ),
    )?;

    Ok((record, secret))
}

pub fn list_tokens(path: &Path) -> anyhow::Result<Vec<TokenRecord>> {
    let connection = open_database(path)?;
    let mut statement = connection.prepare(
        "SELECT id, kind, owner_label, created_at, revoked_at FROM tokens ORDER BY created_at ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(TokenRecord {
            id: row.get(0)?,
            kind: row.get(1)?,
            owner_label: row.get(2)?,
            created_at: row.get(3)?,
            revoked_at: row.get(4)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn revoke_token(path: &Path, token_id: &str) -> anyhow::Result<Option<TokenRecord>> {
    let connection = open_database(path)?;
    let revoked_at = unix_now();
    let changed = connection.execute(
        "UPDATE tokens SET revoked_at = COALESCE(revoked_at, ?1) WHERE id = ?2",
        (revoked_at, token_id),
    )?;
    if changed == 0 {
        return Ok(None);
    }

    get_token_by_id(&connection, token_id).map(Some)
}

pub fn authenticate_token(path: &Path, secret: &str) -> anyhow::Result<Option<TokenRecord>> {
    let connection = open_database(path)?;
    let hash = token_hash(secret);
    let mut statement = connection.prepare(
        "SELECT id, kind, owner_label, created_at, revoked_at
         FROM tokens
         WHERE token_hash = ?1 AND revoked_at IS NULL",
    )?;
    let mut rows = statement.query([hash])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };

    Ok(Some(TokenRecord {
        id: row.get(0)?,
        kind: row.get(1)?,
        owner_label: row.get(2)?,
        created_at: row.get(3)?,
        revoked_at: row.get(4)?,
    }))
}

pub fn append_message_event(
    path: &Path,
    channel_id: &str,
    sender: TokenMetadata,
    body: &str,
    mentions: Vec<String>,
    reply_to_message_id: Option<String>,
) -> anyhow::Result<ChannelEvent> {
    let body = body.trim();
    if body.is_empty() {
        anyhow::bail!("message body is required");
    }
    let connection = open_database(path)?;
    ensure_channel_exists(&connection, channel_id)?;
    connection.execute("BEGIN IMMEDIATE", [])?;
    let inserted = (|| -> anyhow::Result<ChannelEvent> {
        let sequence = next_sequence(&connection, channel_id)?;
        let created_at = unix_now();
        let event = ChannelEvent::Message(ChannelMessage {
            id: make_id("msg"),
            channel_id: channel_id.to_string(),
            sequence,
            sender,
            body: body.to_string(),
            mentions,
            reply_to_message_id,
            created_at,
        });
        insert_event(
            &connection,
            channel_id,
            sequence,
            "message",
            &event,
            created_at,
        )?;
        Ok(event)
    })();
    finish_transaction(&connection, inserted)
}

pub fn append_status_event(
    path: &Path,
    channel_id: &str,
    participant: TokenMetadata,
    state: ParticipantStatusState,
) -> anyhow::Result<ChannelEvent> {
    let connection = open_database(path)?;
    ensure_channel_exists(&connection, channel_id)?;
    connection.execute("BEGIN IMMEDIATE", [])?;
    let inserted = (|| -> anyhow::Result<ChannelEvent> {
        let sequence = next_sequence(&connection, channel_id)?;
        let created_at = unix_now();
        let event = ChannelEvent::Status(StatusUpdate {
            channel_id: channel_id.to_string(),
            sequence,
            participant,
            state,
            created_at,
        });
        insert_event(
            &connection,
            channel_id,
            sequence,
            "status",
            &event,
            created_at,
        )?;
        Ok(event)
    })();
    finish_transaction(&connection, inserted)
}

pub fn list_channel_events(
    path: &Path,
    channel_id: &str,
    after_sequence: i64,
) -> anyhow::Result<Vec<ChannelEvent>> {
    let connection = open_database(path)?;
    ensure_channel_exists(&connection, channel_id)?;
    let mut statement = connection.prepare(
        "SELECT payload_json FROM channel_events
         WHERE channel_id = ?1 AND sequence > ?2
         ORDER BY sequence ASC",
    )?;
    let rows = statement.query_map((channel_id, after_sequence), |row| {
        let payload: String = row.get(0)?;
        let event: ChannelEvent = serde_json::from_str(&payload).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
        })?;
        Ok(event)
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn last_channel_sequence(path: &Path, channel_id: &str) -> anyhow::Result<i64> {
    let connection = open_database(path)?;
    ensure_channel_exists(&connection, channel_id)?;
    last_sequence(&connection, channel_id)
}

fn get_token_by_id(connection: &Connection, token_id: &str) -> anyhow::Result<TokenRecord> {
    Ok(connection.query_row(
        "SELECT id, kind, owner_label, created_at, revoked_at FROM tokens WHERE id = ?1",
        [token_id],
        |row| {
            Ok(TokenRecord {
                id: row.get(0)?,
                kind: row.get(1)?,
                owner_label: row.get(2)?,
                created_at: row.get(3)?,
                revoked_at: row.get(4)?,
            })
        },
    )?)
}

fn ensure_channel_exists(connection: &Connection, channel_id: &str) -> anyhow::Result<()> {
    let exists: i64 = connection.query_row(
        "SELECT COUNT(*) FROM channels WHERE id = ?1",
        [channel_id],
        |row| row.get(0),
    )?;
    if exists == 0 {
        anyhow::bail!("channel not found");
    }
    Ok(())
}

fn next_sequence(connection: &Connection, channel_id: &str) -> anyhow::Result<i64> {
    Ok(last_sequence(connection, channel_id)? + 1)
}

fn last_sequence(connection: &Connection, channel_id: &str) -> anyhow::Result<i64> {
    Ok(connection.query_row(
        "SELECT COALESCE(MAX(sequence), 0) FROM channel_events WHERE channel_id = ?1",
        [channel_id],
        |row| row.get(0),
    )?)
}

fn insert_event(
    connection: &Connection,
    channel_id: &str,
    sequence: i64,
    kind: &str,
    event: &ChannelEvent,
    created_at: i64,
) -> anyhow::Result<()> {
    connection.execute(
        "INSERT INTO channel_events (id, channel_id, sequence, kind, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (
            make_id("evt"),
            channel_id,
            sequence,
            kind,
            serde_json::to_string(event)?,
            created_at,
        ),
    )?;
    Ok(())
}

fn finish_transaction<T>(connection: &Connection, result: anyhow::Result<T>) -> anyhow::Result<T> {
    match result {
        Ok(value) => {
            connection.execute("COMMIT", [])?;
            Ok(value)
        }
        Err(err) => {
            let _ = connection.execute("ROLLBACK", []);
            Err(err)
        }
    }
}

fn make_id(prefix: &str) -> String {
    format!("{prefix}_{}", unique_hex())
}

fn make_token_secret() -> anyhow::Result<String> {
    Ok(format!("apt_{}", random_hex()?))
}

fn unique_hex() -> String {
    let n = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let now = unix_now_nanos();
    let pid = std::process::id();
    let mut hasher = Sha256::new();
    hasher.update(now.to_le_bytes());
    hasher.update(n.to_le_bytes());
    hasher.update(pid.to_le_bytes());
    hex(&hasher.finalize()[..16])
}

fn token_hash(secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hex(&hasher.finalize())
}

fn random_hex() -> anyhow::Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|err| anyhow::anyhow!("generate token secret: {err}"))?;
    Ok(hex(&bytes))
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_secs() as i64
}

fn unix_now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos()
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
