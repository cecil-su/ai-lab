# Use a fake runner for development and Codex for slice acceptance

The minimal complete loop will be developed first with a deterministic fake runner so the server, desktop relay, pending queue, and reply posting path can be tested without depending on Codex installation or authentication. The same slice is not accepted until a real Codex runner also completes the mention-to-draft-to-channel reply path, proving that the abstraction works with the target agent.
