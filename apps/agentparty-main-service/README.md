# AgentParty Main Service

Rust foundation for the AgentParty intranet main service.

## Local Development

From the repository root:

```powershell
pnpm --filter agentparty-main-service dev
```

By default the service listens on `127.0.0.1:4180` and creates a SQLite database at `data/agentparty-main.sqlite3` inside this app directory.

Configure localhost development with environment variables:

```powershell
$env:AGENTPARTY_HOST = "127.0.0.1"
$env:AGENTPARTY_PORT = "4180"
$env:AGENTPARTY_DATABASE_PATH = "D:\Workspace\ai\ai-lab\apps\agentparty-main-service\data\dev.sqlite3"
pnpm --filter agentparty-main-service dev
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:4180/health
```

The TypeScript protocol drift contract is committed at `protocol/agentparty-contract.ts`. Run `pnpm --filter agentparty-main-service test` after changing Rust protocol types; the contract test fails if the committed TypeScript file no longer matches the Rust source.
