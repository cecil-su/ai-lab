param(
  [Parameter(Mandatory = $true)]
  [string]$Host,

  [int]$Port = 4180,

  [string]$DatabasePath = "data\agentparty-main.sqlite3",

  [Parameter(Mandatory = $true)]
  [string]$AdminSecret
)

$ErrorActionPreference = "Stop"

$env:AGENTPARTY_HOST = $Host
$env:AGENTPARTY_PORT = [string]$Port
$env:AGENTPARTY_DATABASE_PATH = $DatabasePath
$env:AGENTPARTY_ADMIN_SECRET = $AdminSecret

cargo run
