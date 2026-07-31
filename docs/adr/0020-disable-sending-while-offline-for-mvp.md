# Disable sending while offline for the MVP

The MVP desktop client will not queue outbound messages while offline. If the connection to the main service is lost, the client may continue showing already loaded history but must disable sending until it reconnects and catches up by message sequence. This avoids duplicate sends, ordering ambiguity, and accidental repeated runner wakeups.
