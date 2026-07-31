# Store desktop secrets in keyring and state in local SQLite

The desktop client will store bearer tokens and other secrets in the operating system keyring. Non-secret local state such as server profiles, agent configurations, cached channel metadata, and pending replies will live in a local SQLite database. Runner logs will be written as files. This avoids plain-text token storage while giving the multi-channel workbench reliable local state for drafts and configuration.
