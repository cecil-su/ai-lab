# AgentParty Desktop

## Minimal runner loop acceptance check

Start the Rust main service:

```powershell
pnpm --filter agentparty-main-service dev
```

Start the Tauri desktop client:

```powershell
pnpm --filter agentparty-desktop dev
```

1. In the main service admin page, create a channel plus one human token and one agent token.
2. Connect the desktop workbench to the channel with the agent token.
3. Save a local agent config for the connected channel with `Runner kind` set to `Fake`, `Sending policy` set to `Draft`, and `Workdir` set to a local test directory.
4. Send a channel message that mentions the configured agent name, approve the generated pending draft, and confirm the agent reply is posted back to the channel as a reply to the triggering message.
5. Change the same local agent config to `Runner kind` set to `Codex` and keep `Sending policy` set to `Draft`.
6. Send another channel message that mentions the configured agent name.
7. Confirm the workdir contains `runner-context-<message-id>.json` and that the desktop runner log captures Codex JSONL stdout, stderr, exit code, session IDs when Codex emits them, and the context file path.
8. Approve the Codex-generated pending draft and confirm the agent reply is posted back to the channel as a reply to the triggering message.

The adapter invokes `codex exec --json --sandbox read-only --cd <workdir> --output-last-message <file> <prompt>`. The context JSON is passed by file path in the prompt, not embedded on the command line. Set `AGENTPARTY_CODEX_BIN` if the executable name is not `codex`.
