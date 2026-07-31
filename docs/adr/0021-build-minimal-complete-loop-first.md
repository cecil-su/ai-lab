# Build the minimal complete loop first

The first deliverable will be a minimal complete loop rather than a broad partial product. It must cover creating a channel and tokens, connecting the Tauri client, sending a mention to a configured local agent, invoking the local relay and runner, placing the result in the pending queue, approving the draft, and posting the agent reply back to the channel. The slice may use one channel, one human token, one agent token, and one runner, but it must cross every architectural boundary end to end.
