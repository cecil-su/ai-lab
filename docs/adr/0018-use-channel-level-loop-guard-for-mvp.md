# Use channel-level loop guard for the MVP

The MVP will implement channel-level loop guard only. Normal and party channels can use different consecutive-agent-message thresholds, and a human message resets the guard. Workflow-specific guards are deferred because they require additional workflow identity and state modeling beyond the minimal protocol needed for the desktop runner loop.
