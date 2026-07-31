# Deploy the main service independently from the desktop client

The MVP will deploy the team intranet main service as an independent server process rather than embedding it inside a user's Tauri desktop app. Desktop clients will connect to the service by URL or IP address and will only own chat UI plus local agent supervision. This avoids tying team channel availability to one user's desktop lifecycle, sleep state, firewall rules, or app restarts.
