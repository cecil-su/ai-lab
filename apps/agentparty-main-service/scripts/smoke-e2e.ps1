param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 4191,
  [string]$AdminSecret = "agentparty-smoke-admin-secret"
)

$ErrorActionPreference = "Stop"

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Invoke-AgentPartyJson {
  param(
    [string]$Method,
    [string]$Uri,
    [object]$Body = $null,
    [hashtable]$Headers = @{},
    [Microsoft.PowerShell.Commands.WebRequestSession]$WebSession = $null
  )

  $request = @{
    Method = $Method
    Uri = $Uri
    Headers = $Headers
    ContentType = "application/json"
  }

  if ($null -ne $Body) {
    $request.Body = $Body | ConvertTo-Json -Depth 8
  }

  if ($null -ne $WebSession) {
    $request.WebSession = $WebSession
  }

  Invoke-RestMethod @request
}

$appDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$databaseDir = Join-Path $appDir "target\smoke"
$databasePath = Join-Path $databaseDir "agentparty-smoke.sqlite3"
$servicePath = Join-Path $appDir "target\debug\agentparty-main-service.exe"
$baseUrl = "http://${HostName}:${Port}"
$service = $null

New-Item -ItemType Directory -Force -Path $databaseDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $databasePath

Push-Location $appDir
try {
  cargo build

  Assert-True (Test-Path $servicePath) "Expected service binary at $servicePath."

  $env:AGENTPARTY_HOST = $HostName
  $env:AGENTPARTY_PORT = [string]$Port
  $env:AGENTPARTY_DATABASE_PATH = $databasePath
  $env:AGENTPARTY_ADMIN_SECRET = $AdminSecret

  $service = Start-Process -FilePath $servicePath -NoNewWindow -PassThru

  $health = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($service.HasExited) {
      throw "AgentParty main service exited before becoming ready."
    }

    try {
      $health = Invoke-RestMethod "$baseUrl/health"
      break
    }
    catch {
      Start-Sleep -Milliseconds 500
    }
  }

  Assert-True ($null -ne $health) "Service did not become ready at $baseUrl/health."
  Assert-True ($health.ok -eq $true) "Health response did not report ok=true."
  Assert-True ($health.database.connected -eq $true) "Health response did not report database.connected=true."

  $login = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/admin/login" `
    -ContentType "application/json" `
    -Body (@{ admin_secret = $AdminSecret } | ConvertTo-Json) `
    -SessionVariable adminSession

  Assert-True ($login.ok -eq $true) "Admin login did not report ok=true."

  $channel = Invoke-AgentPartyJson `
    -Method "Post" `
    -Uri "$baseUrl/admin/api/channels" `
    -Body @{ name = "Smoke Channel"; mode = "normal" } `
    -WebSession $adminSession

  Assert-True (-not [string]::IsNullOrWhiteSpace($channel.id)) "Create channel did not return an id."
  Assert-True ($channel.mode -eq "normal") "Create channel did not return mode=normal."

  $humanToken = Invoke-AgentPartyJson `
    -Method "Post" `
    -Uri "$baseUrl/admin/api/tokens" `
    -Body @{ kind = "human"; owner_label = "Smoke Human" } `
    -WebSession $adminSession

  Assert-True (-not [string]::IsNullOrWhiteSpace($humanToken.token)) "Mint human token did not return a secret."
  Assert-True ($humanToken.metadata.kind -eq "human") "Mint human token metadata did not return kind=human."

  $agentToken = Invoke-AgentPartyJson `
    -Method "Post" `
    -Uri "$baseUrl/admin/api/tokens" `
    -Body @{ kind = "agent"; owner_label = "Smoke Agent" } `
    -WebSession $adminSession

  Assert-True (-not [string]::IsNullOrWhiteSpace($agentToken.token)) "Mint agent token did not return a secret."
  Assert-True ($agentToken.metadata.kind -eq "agent") "Mint agent token metadata did not return kind=agent."

  $authHeaders = @{ Authorization = "Bearer $($humanToken.token)" }
  $me = Invoke-AgentPartyJson `
    -Method "Get" `
    -Uri "$baseUrl/api/auth/me" `
    -Headers $authHeaders

  Assert-True ($me.token.kind -eq "human") "Authenticated token endpoint did not identify the human token."

  $message = Invoke-AgentPartyJson `
    -Method "Post" `
    -Uri "$baseUrl/api/channels/$($channel.id)/messages" `
    -Headers $authHeaders `
    -Body @{
      body = "Smoke test message"
      mentions = @("Smoke Agent")
      reply_to_message_id = $null
    }

  Assert-True ($message.channel_id -eq $channel.id) "Post message returned the wrong channel id."
  Assert-True ($message.body -eq "Smoke test message") "Post message returned the wrong body."

  $history = Invoke-AgentPartyJson `
    -Method "Get" `
    -Uri "$baseUrl/api/channels/$($channel.id)/events" `
    -Headers $authHeaders

  Assert-True ($history.last_sequence -ge 1) "Channel history did not advance last_sequence."
  Assert-True ($history.events.Count -ge 1) "Channel history did not include the posted message."

  Write-Host "AgentParty service smoke passed: $baseUrl channel=$($channel.id)"
}
finally {
  Pop-Location

  if ($service -and -not $service.HasExited) {
    Stop-Process -Id $service.Id -Force
  }
}
