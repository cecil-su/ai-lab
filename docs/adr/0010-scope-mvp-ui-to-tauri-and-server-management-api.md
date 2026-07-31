# Scope MVP UI to Tauri plus a simple management page

The MVP will provide the full chat and local agent management experience in the Tauri desktop client, while the server exposes management APIs and a simple management page for setup tasks such as health checks, channel creation, token minting, and token revocation. We will not build a full web chat UI in the first version because the core product value depends on local runner supervision, which belongs on the desktop. The management page exists to avoid requiring Postman or manual HTTP calls for bootstrap operations.
