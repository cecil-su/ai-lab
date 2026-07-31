# Keep the main service at the collaboration message layer

The MVP main service will manage collaboration messages, identity, channels, mentions, presence, history, permissions, and guard rules, but it will not manage Git repositories, branches, pull requests, worktrees, or merges. Local clients and existing Git tools remain responsible for code workspaces. Agents can report scopes, branches, diffs, and verification results back into the channel through status and messages.
