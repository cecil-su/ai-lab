# Implement the main service in Rust

The local/private main service will be implemented in Rust rather than TypeScript. Although the reference AgentParty protocol is TypeScript and the repository's default stack is Node and TypeScript, the team prefers a single-binary intranet deployment and alignment with the Tauri native backend. Protocol contracts must therefore be kept explicit so the Tauri UI and any TypeScript client code do not drift from the Rust server implementation.
