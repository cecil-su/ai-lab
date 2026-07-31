# Use Rust types as the protocol source of truth

Rust server types will be the source of truth for REST payloads and WebSocket frames. The project should generate or validate TypeScript client types from the Rust contract, such as through OpenAPI for REST and JSON contract tests for WebSocket frames. This prevents the Tauri frontend and local relay code from drifting away from the Rust main service.
