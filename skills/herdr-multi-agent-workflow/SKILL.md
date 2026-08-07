---
name: herdr-multi-agent-workflow
description: Set up, operate, or troubleshoot a safe Herdr-based multi-agent coding workflow using Pi as the orchestrator and Claude Code, Codex, or additional Pi agents as workers and reviewers. Use when the user asks to combine Herdr with coding agents, delegate work across terminal panes, configure Pi-to-Herdr automation, route tasks by model cost or capability, preserve sessions, or prevent concurrent agents from conflicting in one repository.
---

# Herdr Multi-Agent Workflow

Treat Herdr as the persistent terminal runtime and Pi as the optional orchestrator. Do not describe Herdr's official integrations as an automatic task planner: they provide lifecycle status and session restore, while a Pi Herdr control extension provides delegation tools.

## Start with a preflight

1. Read [references/setup.md](references/setup.md) for the current platform and installation mode.
2. Run `python3 scripts/preflight.py` when shell access is available.
3. Report missing commands and configuration without printing API keys or secret values.
4. Ask before installing packages or modifying agent configuration files unless the user already requested setup.

## Choose the operating mode

- Use **manual cockpit mode** for a first trial or a small task: run Pi, Claude Code, and Codex in separate Herdr panes and let the user or main agent hand off tasks explicitly.
- Use **orchestrated mode** only after manual mode works: install a reviewed Pi Herdr control extension so Pi can create panes, delegate, wait, read results, and clean up.
- Use an independent git worktree or a non-overlapping file boundary for every concurrent writer. Never let two agents edit the same worktree concurrently.

## Route work by responsibility

Read [references/routing.md](references/routing.md) before designing or changing model assignments.

Default responsibilities:

1. Give architecture, decomposition, difficult decisions, and final arbitration to the strongest main model.
2. Give read-only exploration, code mapping, log summarization, and test-output triage to a fast low-cost model.
3. Give ordinary implementation to the configured coding worker.
4. Give complex cross-module implementation to a stronger coding worker.
5. Give final review to an agent that did not write the change.

Preserve a user's existing provider mappings unless evidence shows that they fail. Do not confuse an API service tier such as Fast with higher intelligence.

## Execute the workflow

1. Define acceptance criteria and repository constraints.
2. Split tasks by dependency and file ownership.
3. Create worktrees before starting concurrent writers.
4. Start read-only scouts first; collect concise findings.
5. Start implementation agents only after ownership is explicit.
6. Wait for completion and inspect diffs instead of trusting completion messages.
7. Run an independent review, return actionable findings to the responsible worker, and re-test.
8. Merge only validated changes and summarize modifications, checks, unresolved risks, and agent assignments.

Use [references/orchestrator-prompt.md](references/orchestrator-prompt.md) as a starting prompt. Adapt it to the repository and do not paste irrelevant model names or commands.

## Guardrails

- Keep secrets in environment variables or provider configuration; never place keys in prompts, logs, commits, or pane titles.
- Treat third-party Pi packages as code with local machine access. Inspect the source, pin a version where practical, and trial it in a disposable repository.
- Avoid excessive delegation. Handle small, known, single-file changes directly.
- Do not grant every worker permission to commit, push, deploy, or modify infrastructure.
- Stop and ask when a task needs credentials, destructive cleanup, production access, or ambiguous repository ownership.
- On Windows preview builds, prefer mouse controls when a documented keybinding does not work and verify integration status before diagnosing the model.
