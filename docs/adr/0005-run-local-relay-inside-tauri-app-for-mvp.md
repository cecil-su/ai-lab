# Run the local relay inside the Tauri app for the MVP

The MVP local relay will run only while the Tauri desktop client is open and the user has explicitly started a local agent. We will not build a background daemon, login item, or always-on supervisor in the first version. Presence must accurately show that an agent is wakeable only while the app and local relay are running, leaving daemonization as a later product decision.
