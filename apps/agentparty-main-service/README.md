# AgentParty Main Service

Rust foundation for the AgentParty intranet main service.

## Local Development

From the repository root:

```powershell
pnpm --filter agentparty-main-service dev
```

By default the service listens on `127.0.0.1:4180` and creates a SQLite database at `data/agentparty-main.sqlite3` inside this app directory.
When bound to localhost, the development admin secret defaults to `agentparty-dev-admin-secret`. Set `AGENTPARTY_ADMIN_SECRET` for any non-localhost bind address.

Configure localhost development with environment variables:

```powershell
$env:AGENTPARTY_HOST = "127.0.0.1"
$env:AGENTPARTY_PORT = "4180"
$env:AGENTPARTY_DATABASE_PATH = "D:\Workspace\ai\ai-lab\apps\agentparty-main-service\data\dev.sqlite3"
$env:AGENTPARTY_ADMIN_SECRET = "replace-this-local-secret"
pnpm --filter agentparty-main-service dev
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:4180/health
```

Management page:

```text
http://127.0.0.1:4180/admin
```

The page signs in with the configured admin secret, then uses the admin API to create normal or party channels and mint human or agent tokens. Minted token secrets are returned only in the mint response. Later token list calls return only non-sensitive metadata.

The TypeScript protocol drift contract is committed at `protocol/agentparty-contract.ts`. Run `pnpm --filter agentparty-main-service test` after changing Rust protocol types; the contract test fails if the committed TypeScript file no longer matches the Rust source.
