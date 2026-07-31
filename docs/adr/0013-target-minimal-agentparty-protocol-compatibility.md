# Target minimal AgentParty protocol compatibility

The local/private main service will initially implement only the protocol surface needed for the desktop runner loop: channels, tokens, messages, WebSocket delivery, mentions, presence, status, history, and loop guard. We will not attempt full upstream AgentParty compatibility in the MVP, leaving webhooks, OIDC, spawned child agents, capture ledgers, completion review, invite links, workflow guard, and message mutation features for later evaluation.
