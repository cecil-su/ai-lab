param(
  [string]$Id,

  [string]$Name = "Local AgentParty",

  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $true)]
  [string]$ChannelId,

  [Parameter(Mandatory = $true)]
  [string]$Token
)

$ErrorActionPreference = "Stop"

$appDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$tauriDir = Join-Path $appDir "src-tauri"
$binaryPath = Join-Path $tauriDir "target\debug\agentparty-desktop.exe"

cargo build --manifest-path (Join-Path $tauriDir "Cargo.toml")

$arguments = @(
  "bootstrap-profile",
  "--name", $Name,
  "--server-url", $ServerUrl,
  "--channel-id", $ChannelId,
  "--token", $Token
)

if (-not [string]::IsNullOrWhiteSpace($Id)) {
  $arguments += @("--id", $Id)
}

& $binaryPath @arguments
