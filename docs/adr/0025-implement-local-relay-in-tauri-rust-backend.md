# Implement the local relay in the Tauri Rust backend

The desktop client's local relay will be implemented in the Tauri Rust backend rather than primarily in the TypeScript UI. Rust will own WebSocket connections, mention routing, runner process management, local logs, and creation of pending runner results. The TypeScript UI will configure agents, display channel state, and let users approve or discard pending replies.
