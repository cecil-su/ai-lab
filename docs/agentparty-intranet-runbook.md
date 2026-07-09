# AgentParty Intranet Runbook

This runbook covers the first repeatable workflow for running the Rust main service on a trusted intranet and connecting the Tauri desktop workbench.

## Local Development

From the repository root, start the main service with local defaults:

```powershell
pnpm --filter agentparty-main-service dev:local
```

The local script binds to `127.0.0.1:4180`, stores SQLite data at `apps/agentparty-main-service/data/agentparty-main.sqlite3`, and uses the development admin secret `agentparty-dev-admin-secret`.

Override the local SQLite file or admin secret when needed:

```powershell
pnpm --filter agentparty-main-service dev:local -- -DatabasePath "data\dev.sqlite3" -AdminSecret "replace-this-local-secret"
```

Check the service:

```powershell
Invoke-RestMethod http://127.0.0.1:4180/health
```

Open the management page:

```text
http://127.0.0.1:4180/admin
```

## Intranet Service

Choose the machine's intranet address, a port, a durable SQLite path, and a non-default admin secret:

```powershell
pnpm --filter agentparty-main-service dev:intranet -- `
  -Host "192.168.1.20" `
  -Port 4180 `
  -DatabasePath "D:\AgentParty\data\agentparty-main.sqlite3" `
  -AdminSecret "replace-with-a-long-random-secret"
```

The script maps those values to the service environment variables:

```text
AGENTPARTY_HOST
AGENTPARTY_PORT
AGENTPARTY_DATABASE_PATH
AGENTPARTY_ADMIN_SECRET
```

`AGENTPARTY_ADMIN_SECRET` is required whenever the service binds outside localhost. Keep it out of shared shell history and rotate it if it is exposed.

## HTTP And HTTPS

The current service is suitable for trusted-intranet HTTP while the deployment is limited to a private LAN/VPN and tokens are issued only to trusted operators. Do not expose the Rust service directly to the public internet.

For any untrusted network, internet access, or stricter credential handling, put the service behind an HTTPS reverse proxy such as Caddy, nginx, or an internal gateway. Terminate TLS at the proxy and forward to the Rust service on a private interface or localhost.

## Initial Channels And Tokens

1. Open `/admin` on the service URL.
2. Sign in with the configured admin secret.
3. Create a channel. Use a normal channel for directed runner tests or a party channel when multiple agents should coordinate in the same room.
4. Mint a human token for the operator.
5. Mint an agent token for each desktop runner identity.
6. Copy minted token secrets immediately. The management page only shows the token secret in the mint response.

## Desktop Client

Start the Tauri workbench against the local frontend dev server:

```powershell
pnpm --filter agentparty-desktop dev:tauri
```

To start both the local Rust service and the Tauri workbench with one command:

```powershell
pnpm --filter agentparty-desktop dev:local
```

In the desktop workbench, create or edit a server profile with:

```text
Server URL: http://127.0.0.1:4180
Channel ID: <channel id from the management page>
Token: <human or agent token secret>
```

Or bootstrap the profile through the same Tauri backend that stores tokens:

```powershell
pnpm --filter agentparty-desktop bootstrap:profile -- `
  -Name "Local AgentParty" `
  -ServerUrl http://127.0.0.1:4180 `
  -ChannelId <channel id from the management page> `
  -Token <human or agent token secret>
```

For local development, create the channel, mint an agent token, and save the desktop profile in one command after the service is running:

```powershell
pnpm --filter agentparty-desktop bootstrap:local
```

For an intranet service, use the intranet host and port instead:

```text
Server URL: http://192.168.1.20:4180
```

The desktop client stores the profile URL and channel ID in its app data. Token storage is handled by the Tauri backend, using Windows credentials on Windows.

## Runner Smoke Test

Run the service-side API smoke test:

```powershell
pnpm --filter agentparty-main-service smoke:e2e
```

The script starts the Rust service on a temporary local port, creates a temporary SQLite database, signs in to the admin API, creates a channel, mints human and agent tokens, authenticates with the human token, posts a message, and reads channel history.

Manual desktop smoke:

1. Start the service with `pnpm --filter agentparty-main-service dev:local`.
2. Start the desktop app with `pnpm --filter agentparty-desktop dev:tauri`.
3. In `/admin`, create one channel, one human token, and one agent token.
4. Connect the desktop workbench with the channel ID and agent token.
5. Add a local agent config for that channel with `Runner kind` set to `Fake`, `Sending policy` set to `Draft`, and `Workdir` set to a local test directory.
6. Send a message that mentions the configured agent name.
7. Confirm a pending draft appears, approve it, and confirm the reply is posted back to the channel.

## Verification Record

This workflow was verified on Windows on 2026-07-09 with:

```powershell
pnpm --filter agentparty-desktop exec tauri --version
pnpm --filter agentparty-main-service check
pnpm --filter agentparty-main-service test
pnpm --filter agentparty-main-service smoke:e2e
pnpm --filter agentparty-main-service build:release
pnpm --filter agentparty-desktop typecheck
pnpm --filter agentparty-desktop test
pnpm --filter agentparty-desktop cargo:check
pnpm --filter agentparty-desktop build
pnpm --filter agentparty-desktop build:tauri
```

The Tauri CLI resolved as `tauri-cli 2.11.4`. The server release binary and desktop executable were produced at the artifact paths listed below.

## Packaging

Server binary:

```powershell
pnpm --filter agentparty-main-service build:release
```

Expected artifact:

```text
apps/agentparty-main-service/target/release/agentparty-main-service.exe
```

Run the release binary with the same environment variables used by the development scripts.

Desktop app:

```powershell
pnpm --filter agentparty-desktop build:tauri
```

Expected Windows artifacts are produced under:

```text
apps/agentparty-desktop/src-tauri/target/release/agentparty-desktop.exe
```

If installer bundling is enabled later, Tauri will place bundle artifacts under `apps/agentparty-desktop/src-tauri/target/release/bundle/`.

Release automation is intentionally deferred. For the first intranet rollout, archive the server binary plus a short environment-variable manifest, and distribute the generated desktop executable or later installer artifact.
