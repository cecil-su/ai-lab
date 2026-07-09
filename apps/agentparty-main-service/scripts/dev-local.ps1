param(
  [string]$DatabasePath = "data\agentparty-main.sqlite3",
  [string]$AdminSecret = "agentparty-dev-admin-secret"
)

$ErrorActionPreference = "Stop"

$env:AGENTPARTY_HOST = "127.0.0.1"
$env:AGENTPARTY_PORT = "4180"
$env:AGENTPARTY_DATABASE_PATH = $DatabasePath
$env:AGENTPARTY_ADMIN_SECRET = $AdminSecret

cargo run
