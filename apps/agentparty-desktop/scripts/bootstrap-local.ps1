param(
  [string]$Name = "Local AgentParty",
  [string]$ServerUrl = "http://127.0.0.1:4180",
  [string]$AdminSecret = "agentparty-dev-admin-secret",
  [string]$ChannelName = "Local AgentParty",
  [ValidateSet("human", "agent")]
  [string]$TokenKind = "agent",
  [string]$TokenOwner = "Local Desktop"
)

$ErrorActionPreference = "Stop"

$ServerUrl = $ServerUrl.TrimEnd("/")
$session = $null
$loginBody = @{ admin_secret = $AdminSecret } | ConvertTo-Json
Invoke-RestMethod `
  -Method Post `
  -Uri "$ServerUrl/admin/login" `
  -ContentType "application/json" `
  -Body $loginBody `
  -SessionVariable session | Out-Null

$channel = Invoke-RestMethod `
  -Method Post `
  -Uri "$ServerUrl/admin/api/channels" `
  -ContentType "application/json" `
  -Body (@{ name = $ChannelName; mode = "normal" } | ConvertTo-Json) `
  -WebSession $session

$token = Invoke-RestMethod `
  -Method Post `
  -Uri "$ServerUrl/admin/api/tokens" `
  -ContentType "application/json" `
  -Body (@{ kind = $TokenKind; owner_label = $TokenOwner } | ConvertTo-Json) `
  -WebSession $session

$bootstrapScript = Join-Path $PSScriptRoot "bootstrap-profile.ps1"
& $bootstrapScript `
  -Name $Name `
  -ServerUrl $ServerUrl `
  -ChannelId $channel.id `
  -Token $token.token

Write-Host "Created $TokenKind profile '$Name' for channel $($channel.id)"
