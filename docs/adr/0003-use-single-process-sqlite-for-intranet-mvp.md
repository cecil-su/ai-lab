# Use single-process SQLite for the intranet MVP

The intranet MVP will run as one server process backed by a SQLite database file. Persistent state such as channels, tokens, messages, membership, and history will live in SQLite, while live WebSocket connections and presence will live in process memory. This keeps deployment simple for a team-local service and avoids requiring Postgres, Redis, or a cluster before the core human-agent collaboration loop is proven.
