use rusqlite::Connection;
use std::path::Path;

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

        INSERT OR IGNORE INTO service_metadata (key, value)
        VALUES ('schema_version', '1');
        "#,
    )?;

    Ok(())
}
