param(
  [string]$DatabasePath = "..\agentparty-main-service\data\agentparty-main.sqlite3",
  [string]$AdminSecret = "agentparty-dev-admin-secret"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$serviceDir = Join-Path $repoRoot "apps\agentparty-main-service"

$env:AGENTPARTY_HOST = "127.0.0.1"
$env:AGENTPARTY_PORT = "4180"
$env:AGENTPARTY_DATABASE_PATH = $DatabasePath
$env:AGENTPARTY_ADMIN_SECRET = $AdminSecret

$service = Start-Process `
  -FilePath "cargo" `
  -ArgumentList @("run") `
  -WorkingDirectory $serviceDir `
  -NoNewWindow `
  -PassThru

try {
  $healthUrl = "http://127.0.0.1:4180/health"
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($service.HasExited) {
      throw "AgentParty main service exited before becoming ready."
    }

    try {
      Invoke-RestMethod $healthUrl | Out-Null
      $ready = $true
      break
    }
    catch {
      Start-Sleep -Seconds 1
    }
  }

  if (-not $ready) {
    throw "AgentParty main service did not become ready at $healthUrl."
  }

  pnpm --filter agentparty-desktop dev:tauri
}
finally {
  if ($service -and -not $service.HasExited) {
    Stop-Process -Id $service.Id
  }
}
