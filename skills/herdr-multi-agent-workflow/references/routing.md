# Model and agent routing

## Recommended baseline

| Work | Agent/model class | Write access |
| --- | --- | --- |
| Requirements, architecture, decomposition | Strong main reasoning model | Usually read-only until plan accepted |
| Repository scouting, code maps, logs | Fast low-cost model | Read-only |
| Routine implementation | Economical coding model | One isolated worktree |
| Complex cross-module implementation | Strong coding model | One isolated worktree |
| Review and risk analysis | Independent strong model | Read-only during review |
| Test execution and failure summary | Low-cost model or deterministic command | No source edits unless assigned |

## GPT-5.6 + DeepSeek example

- Use GPT-5.6 Sol for main planning, architecture, arbitration, and difficult final review.
- Use GPT-5.6 Terra for everyday coordination when Sol-level reasoning is unnecessary.
- Use GPT-5.6 Luna for high-volume read-only exploration, logs, and test-output triage.
- Keep Claude Code with DeepSeek V4 Flash for routine implementation when it is already reliable.
- Use DeepSeek V4 Pro with the configured long-context variant for complex implementation.
- Use Sol Fast only when latency is the real bottleneck. It is a paid service tier, not a quality upgrade.

## Concurrency rules

Parallelize only independent tasks. For concurrent writers, create one branch and worktree per task. State file ownership in every worker prompt. If ownership overlaps, sequence the tasks instead.

Do not make the main agent repeatedly reread the entire repository. Ask scouts for concise findings containing file paths, symbols, risks, and recommended next actions.
