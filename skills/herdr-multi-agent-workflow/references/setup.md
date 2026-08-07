# Setup reference

## Components

| Component | Responsibility |
| --- | --- |
| Herdr | Persistent workspaces, panes, agent state, detach/reattach, session restore |
| Official Herdr integration | Reports lifecycle or session identity to Herdr |
| Pi | Main agent and optional orchestrator |
| Pi Herdr control extension | Lets Pi create and drive Herdr panes; third-party code |
| Claude Code / Codex / Pi worker | Performs implementation, exploration, review, or tests |

## Official integrations

Install only the agents the user actually runs:

```sh
herdr integration install pi
herdr integration install claude
herdr integration install codex
herdr integration status
```

These commands modify the respective agent configuration directories. Confirm scope before running them unless setup was explicitly requested.

## Optional Pi control extension

One current community option is:

```sh
pi install npm:@andrewjacop/pi-herdr
```

Review its source and current package documentation before installation. The package is distinct from `herdr integration install pi`: the official integration reports state and identity, while the community extension adds control and delegation tools.

## Startup order

1. Export provider and model configuration in the parent shell.
2. Change to the repository root.
3. Start `herdr`.
4. Start the main `pi` process in the first pane.
5. Verify the main agent appears in `herdr agent list`.
6. Test one worker and one handoff before adding concurrency.

Child panes inherit environment from the Herdr process. If Claude Code must use an Anthropic-compatible provider, set that configuration before starting Herdr. Never print the corresponding key.

## Diagnostics

```sh
herdr integration status
herdr agent list
herdr pane read <pane-id> --source recent --lines 50
```

Check, in order:

1. The agent command exists on `PATH`.
2. The integration was installed for the same OS user running Herdr.
3. The agent was launched inside a Herdr pane.
4. The parent Herdr process inherited the required environment.
5. The Pi control extension exposes its delegation tools after Pi restarts.

Native Windows releases may be preview builds. Prefer documented mouse actions when prefix shortcuts are inconsistent.
