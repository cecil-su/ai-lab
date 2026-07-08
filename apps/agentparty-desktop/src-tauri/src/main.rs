use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

const APP_DIR: &str = "agentparty-desktop";
const CREDENTIAL_PREFIX: &str = "AgentParty Desktop Token";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerProfileInput {
    id: Option<String>,
    name: String,
    server_url: String,
    channel_id: String,
    token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerProfile {
    id: String,
    name: String,
    server_url: String,
    channel_id: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalAgentConfigInput {
    id: Option<String>,
    name: String,
    channel_id: String,
    runner_kind: RunnerKind,
    custom_command: Option<String>,
    workdir: String,
    workdir_mode: WorkdirMode,
    sending_policy: SendingPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalAgentConfig {
    id: String,
    name: String,
    channel_id: String,
    runner_kind: RunnerKind,
    custom_command: Option<String>,
    workdir: String,
    #[serde(default = "default_workdir_mode")]
    workdir_mode: WorkdirMode,
    sending_policy: SendingPolicy,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum RunnerKind {
    Fake,
    Codex,
    CustomCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum WorkdirMode {
    ReadOnly,
    Writable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum SendingPolicy {
    Draft,
    AutoSend,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunnerResult {
    status: String,
    draft_reply: String,
    stdout: String,
    stderr: String,
    exit_code: i32,
    context_file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunnerLogEntry {
    id: String,
    agent_config_id: String,
    triggering_message_id: String,
    created_at: i64,
    status: String,
    draft_reply: String,
    stdout: String,
    stderr: String,
    exit_code: i32,
    context_file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingDraftInput {
    profile_id: String,
    server_url: String,
    channel_id: String,
    agent_config_id: String,
    agent_name: String,
    triggering_message_id: String,
    body: String,
    status: String,
    error: Option<String>,
    runner_result: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingDraft {
    id: String,
    profile_id: String,
    server_url: String,
    channel_id: String,
    agent_config_id: String,
    agent_name: String,
    triggering_message_id: String,
    body: String,
    status: String,
    error: Option<String>,
    runner_result: Option<Value>,
    created_at: i64,
    updated_at: i64,
}

#[tauri::command]
fn list_server_profiles() -> Result<Vec<ServerProfile>, String> {
    read_profiles().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_server_profile(input: ServerProfileInput) -> Result<ServerProfile, String> {
    let mut profiles = read_profiles().map_err(|error| error.to_string())?;
    let now = unix_now();
    let id = input.id.unwrap_or_else(make_profile_id);
    let existing = profiles.iter().find(|profile| profile.id == id).cloned();
    let profile = ServerProfile {
        id: id.clone(),
        name: input.name.trim().to_string(),
        server_url: normalize_server_url(&input.server_url)?,
        channel_id: input.channel_id.trim().to_string(),
        created_at: existing
            .as_ref()
            .map(|profile| profile.created_at)
            .unwrap_or(now),
        updated_at: now,
    };

    profiles.retain(|item| item.id != id);
    profiles.push(profile.clone());
    profiles.sort_by_key(|item| item.created_at);
    write_token(&profile.id, &input.token)?;
    write_profiles(&profiles).map_err(|error| error.to_string())?;
    Ok(profile)
}

#[tauri::command]
fn get_server_profile_token(profile_id: String) -> Result<String, String> {
    read_token(&profile_id)
}

#[tauri::command]
fn list_local_agent_configs() -> Result<Vec<LocalAgentConfig>, String> {
    read_agent_configs().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_local_agent_config(input: LocalAgentConfigInput) -> Result<LocalAgentConfig, String> {
    let mut configs = read_agent_configs().map_err(|error| error.to_string())?;
    let now = unix_now();
    let id = input
        .id
        .unwrap_or_else(|| format!("agent-{}", unix_now_millis()));
    let existing = configs.iter().find(|config| config.id == id).cloned();
    let config = LocalAgentConfig {
        id: id.clone(),
        name: input.name.trim().to_string(),
        channel_id: input.channel_id.trim().to_string(),
        runner_kind: input.runner_kind,
        custom_command: input
            .custom_command
            .and_then(|command| non_empty_trimmed(command.as_str())),
        workdir: input.workdir.trim().to_string(),
        workdir_mode: input.workdir_mode,
        sending_policy: input.sending_policy,
        created_at: existing
            .as_ref()
            .map(|config| config.created_at)
            .unwrap_or(now),
        updated_at: now,
    };

    configs.retain(|item| item.id != id);
    configs.push(config.clone());
    configs.sort_by_key(|item| item.created_at);
    write_agent_configs(&configs).map_err(|error| error.to_string())?;
    Ok(config)
}

fn default_workdir_mode() -> WorkdirMode {
    WorkdirMode::ReadOnly
}

fn non_empty_trimmed(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

#[tauri::command]
fn run_fake_runner(agent_config: LocalAgentConfig, context: Value) -> Result<RunnerResult, String> {
    let runner_context = write_runner_context(&agent_config, &context)?;

    let result = RunnerResult {
        status: "done".to_string(),
        draft_reply: format!(
            "Fake runner {} saw: {}",
            agent_config.name, runner_context.body
        ),
        stdout: format!(
            "fake runner handled {}",
            runner_context.triggering_message_id
        ),
        stderr: String::new(),
        exit_code: 0,
        context_file_path: runner_context
            .context_file_path
            .to_string_lossy()
            .to_string(),
    };
    append_runner_result_log(
        &agent_config,
        &runner_context.triggering_message_id,
        &result,
    )?;
    Ok(result)
}

#[tauri::command]
fn run_codex_runner(
    agent_config: LocalAgentConfig,
    context: Value,
) -> Result<RunnerResult, String> {
    run_codex_runner_with_executor(agent_config, context, run_codex_process)
}

#[tauri::command]
fn run_custom_command_runner(
    agent_config: LocalAgentConfig,
    context: Value,
) -> Result<RunnerResult, String> {
    run_custom_command_runner_with_executor(agent_config, context, run_custom_command_process)
}

struct RunnerContextFile {
    triggering_message_id: String,
    body: String,
    context_file_path: PathBuf,
}

struct CodexProcessOutput {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

struct CustomCommandProcessRequest {
    command: String,
    context_file_path: PathBuf,
    stdin: String,
    env: HashMap<String, String>,
}

struct CustomCommandProcessOutput {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

fn run_codex_runner_with_executor(
    agent_config: LocalAgentConfig,
    context: Value,
    execute: impl FnOnce(&Path, &Path) -> Result<CodexProcessOutput, String>,
) -> Result<RunnerResult, String> {
    let runner_context = write_runner_context(&agent_config, &context)?;
    let final_message_path = runner_context
        .context_file_path
        .with_extension("codex-final.txt");
    let process_output = execute(&runner_context.context_file_path, &final_message_path);
    let result = match process_output {
        Ok(output) => normalize_codex_output(&runner_context, &final_message_path, output),
        Err(error) => RunnerResult {
            status: "blocked".to_string(),
            draft_reply: String::new(),
            stdout: String::new(),
            stderr: error,
            exit_code: 1,
            context_file_path: runner_context
                .context_file_path
                .to_string_lossy()
                .to_string(),
        },
    };
    append_runner_result_log(
        &agent_config,
        &runner_context.triggering_message_id,
        &result,
    )?;
    Ok(result)
}

fn run_codex_process(
    context_file_path: &Path,
    final_message_path: &Path,
) -> Result<CodexProcessOutput, String> {
    let codex_bin = std::env::var("AGENTPARTY_CODEX_BIN").unwrap_or_else(|_| "codex".to_string());
    let workdir = context_file_path
        .parent()
        .ok_or_else(|| "runner context file has no parent directory".to_string())?;
    let prompt = format!(
        "You are replying as a local AgentParty agent. Read the runner context JSON from this file: {}. Return only the draft reply body for the triggering message. Do not post to the channel.",
        context_file_path.display()
    );
    let output = Command::new(codex_bin)
        .arg("exec")
        .arg("--json")
        .arg("--sandbox")
        .arg("read-only")
        .arg("--cd")
        .arg(workdir)
        .arg("--output-last-message")
        .arg(final_message_path)
        .arg(prompt)
        .output()
        .map_err(|error| format!("failed to start Codex runner: {error}"))?;

    Ok(CodexProcessOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(1),
    })
}

fn normalize_codex_output(
    runner_context: &RunnerContextFile,
    final_message_path: &Path,
    output: CodexProcessOutput,
) -> RunnerResult {
    let final_message = fs::read_to_string(final_message_path)
        .ok()
        .map(|message| message.trim().to_string())
        .filter(|message| !message.is_empty());
    let status = if output.exit_code == 0 && final_message.is_some() {
        "done"
    } else {
        "blocked"
    };
    let stderr = if output.exit_code == 0 && final_message.is_none() {
        "Codex did not produce a draft reply".to_string()
    } else if output.exit_code == 0 {
        output.stderr
    } else if output.stderr.trim().is_empty() {
        format!("Codex exited with code {}", output.exit_code)
    } else {
        output.stderr
    };

    RunnerResult {
        status: status.to_string(),
        draft_reply: final_message.unwrap_or_default(),
        stdout: append_codex_session_metadata(output.stdout),
        stderr,
        exit_code: output.exit_code,
        context_file_path: runner_context
            .context_file_path
            .to_string_lossy()
            .to_string(),
    }
}

fn run_custom_command_runner_with_executor(
    agent_config: LocalAgentConfig,
    context: Value,
    execute: impl FnOnce(CustomCommandProcessRequest) -> Result<CustomCommandProcessOutput, String>,
) -> Result<RunnerResult, String> {
    let runner_context = write_runner_context(&agent_config, &context)?;
    let command = agent_config
        .custom_command
        .as_deref()
        .and_then(non_empty_trimmed);
    let result = match command {
        Some(command) => {
            let mut env = HashMap::new();
            env.insert(
                "AP_CONTEXT_FILE".to_string(),
                runner_context
                    .context_file_path
                    .to_string_lossy()
                    .to_string(),
            );
            let request = CustomCommandProcessRequest {
                command,
                context_file_path: runner_context.context_file_path.clone(),
                stdin: runner_context.body.clone(),
                env,
            };
            match execute(request) {
                Ok(output) => normalize_custom_command_output(&runner_context, output),
                Err(error) => RunnerResult {
                    status: "blocked".to_string(),
                    draft_reply: String::new(),
                    stdout: String::new(),
                    stderr: error,
                    exit_code: 1,
                    context_file_path: runner_context
                        .context_file_path
                        .to_string_lossy()
                        .to_string(),
                },
            }
        }
        None => RunnerResult {
            status: "blocked".to_string(),
            draft_reply: String::new(),
            stdout: String::new(),
            stderr: "Custom command is required".to_string(),
            exit_code: 1,
            context_file_path: runner_context
                .context_file_path
                .to_string_lossy()
                .to_string(),
        },
    };
    append_runner_result_log(
        &agent_config,
        &runner_context.triggering_message_id,
        &result,
    )?;
    Ok(result)
}

fn run_custom_command_process(
    request: CustomCommandProcessRequest,
) -> Result<CustomCommandProcessOutput, String> {
    let workdir = request
        .context_file_path
        .parent()
        .ok_or_else(|| "runner context file has no parent directory".to_string())?;
    let mut command = shell_command(&request.command);
    let mut child = command
        .current_dir(workdir)
        .envs(request.env.iter())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start custom command runner: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(request.stdin.as_bytes())
            .map_err(|error| format!("failed to write custom command stdin: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for custom command runner: {error}"))?;

    Ok(CustomCommandProcessOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(1),
    })
}

#[cfg(windows)]
fn shell_command(command: &str) -> Command {
    let mut shell = Command::new("powershell");
    shell.arg("-NoProfile").arg("-Command").arg(command);
    shell
}

#[cfg(not(windows))]
fn shell_command(command: &str) -> Command {
    let mut shell = Command::new("sh");
    shell.arg("-c").arg(command);
    shell
}

fn normalize_custom_command_output(
    runner_context: &RunnerContextFile,
    output: CustomCommandProcessOutput,
) -> RunnerResult {
    let draft_reply = output.stdout.trim().to_string();
    let status = if output.exit_code == 0 && !draft_reply.is_empty() {
        "done"
    } else {
        "blocked"
    };
    let stderr = if output.exit_code == 0 && draft_reply.is_empty() {
        "Custom command did not produce a draft reply".to_string()
    } else if output.exit_code == 0 {
        output.stderr
    } else if output.stderr.trim().is_empty() {
        format!("Custom command exited with code {}", output.exit_code)
    } else {
        output.stderr
    };

    RunnerResult {
        status: status.to_string(),
        draft_reply: if status == "done" {
            draft_reply
        } else {
            String::new()
        },
        stdout: output.stdout,
        stderr,
        exit_code: output.exit_code,
        context_file_path: runner_context
            .context_file_path
            .to_string_lossy()
            .to_string(),
    }
}

fn append_codex_session_metadata(stdout: String) -> String {
    let session_ids = stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|event| {
            event
                .get("session_id")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    if session_ids.is_empty() {
        stdout
    } else {
        format!("{stdout}\n[codex session_ids: {}]", session_ids.join(", "))
    }
}

fn write_runner_context(
    agent_config: &LocalAgentConfig,
    context: &Value,
) -> Result<RunnerContextFile, String> {
    let message = context
        .get("triggeringMessage")
        .ok_or_else(|| "runner context missing triggeringMessage".to_string())?;
    let triggering_message_id = message
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "runner context missing triggeringMessage.id".to_string())?
        .to_string();
    let body = message
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let workdir = PathBuf::from(&agent_config.workdir);
    fs::create_dir_all(&workdir).map_err(|error| error.to_string())?;
    let context_file_path = workdir.join(format!("runner-context-{triggering_message_id}.json"));
    let context_json = serde_json::to_string_pretty(context).map_err(|error| error.to_string())?;
    fs::write(&context_file_path, context_json).map_err(|error| error.to_string())?;

    Ok(RunnerContextFile {
        triggering_message_id,
        body,
        context_file_path,
    })
}

fn append_runner_result_log(
    agent_config: &LocalAgentConfig,
    triggering_message_id: &str,
    result: &RunnerResult,
) -> Result<(), String> {
    append_runner_log(RunnerLogEntry {
        id: format!("log-{}", unix_now_millis()),
        agent_config_id: agent_config.id.clone(),
        triggering_message_id: triggering_message_id.to_string(),
        created_at: unix_now(),
        status: result.status.clone(),
        draft_reply: result.draft_reply.clone(),
        stdout: result.stdout.clone(),
        stderr: result.stderr.clone(),
        exit_code: result.exit_code,
        context_file_path: result.context_file_path.clone(),
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_runner_logs() -> Result<Vec<RunnerLogEntry>, String> {
    read_runner_logs().map_err(|error| error.to_string())
}

#[tauri::command]
fn list_pending_drafts() -> Result<Vec<PendingDraft>, String> {
    db_list_pending_drafts().map_err(|error| error.to_string())
}

#[tauri::command]
fn create_pending_draft(input: PendingDraftInput) -> Result<PendingDraft, String> {
    db_create_pending_draft(input).map_err(|error| error.to_string())
}

#[tauri::command]
fn update_pending_draft_body(id: String, body: String) -> Result<PendingDraft, String> {
    db_update_pending_draft_body(&id, &body).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_pending_draft(id: String) -> Result<(), String> {
    db_delete_pending_draft(&id).map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_server_profiles,
            save_server_profile,
            get_server_profile_token,
            list_local_agent_configs,
            save_local_agent_config,
            run_fake_runner,
            run_codex_runner,
            run_custom_command_runner,
            list_runner_logs,
            list_pending_drafts,
            create_pending_draft,
            update_pending_draft_body,
            delete_pending_draft
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentParty desktop workbench");
}

fn normalize_server_url(raw_url: &str) -> Result<String, String> {
    let url = raw_url.trim().trim_end_matches('/').to_string();
    if url.starts_with("http://") || url.starts_with("https://") {
        Ok(url)
    } else {
        Err("serverUrl must start with http:// or https://".to_string())
    }
}

fn profiles_path() -> Result<PathBuf, std::io::Error> {
    app_data_path("profiles.json")
}

fn app_data_path(file_name: &str) -> Result<PathBuf, std::io::Error> {
    let base = std::env::var_os("AGENTPARTY_DESKTOP_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("APPDATA").map(PathBuf::from))
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join(APP_DIR);
    fs::create_dir_all(&dir)?;
    Ok(dir.join(file_name))
}

fn agent_configs_path() -> Result<PathBuf, std::io::Error> {
    app_data_path("agents.json")
}

fn runner_logs_path() -> Result<PathBuf, std::io::Error> {
    app_data_path("runner-logs.json")
}

fn local_database_path() -> Result<PathBuf, std::io::Error> {
    app_data_path("agentparty-desktop.sqlite3")
}

fn read_profiles() -> Result<Vec<ServerProfile>, Box<dyn std::error::Error>> {
    let path = profiles_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}

fn write_profiles(profiles: &[ServerProfile]) -> Result<(), Box<dyn std::error::Error>> {
    let path = profiles_path()?;
    let raw = serde_json::to_string_pretty(profiles)?;
    fs::write(path, raw)?;
    Ok(())
}

fn read_agent_configs() -> Result<Vec<LocalAgentConfig>, Box<dyn std::error::Error>> {
    let path = agent_configs_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}

fn write_agent_configs(configs: &[LocalAgentConfig]) -> Result<(), Box<dyn std::error::Error>> {
    let path = agent_configs_path()?;
    let raw = serde_json::to_string_pretty(configs)?;
    fs::write(path, raw)?;
    Ok(())
}

fn read_runner_logs() -> Result<Vec<RunnerLogEntry>, Box<dyn std::error::Error>> {
    let path = runner_logs_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}

fn append_runner_log(log: RunnerLogEntry) -> Result<(), Box<dyn std::error::Error>> {
    let mut logs = read_runner_logs()?;
    logs.push(log);
    let path = runner_logs_path()?;
    let raw = serde_json::to_string_pretty(&logs)?;
    fs::write(path, raw)?;
    Ok(())
}

fn open_local_database() -> Result<Connection, Box<dyn std::error::Error>> {
    let connection = Connection::open(local_database_path()?)?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS pending_drafts (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            server_url TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            agent_config_id TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            triggering_message_id TEXT NOT NULL,
            body TEXT NOT NULL,
            status TEXT NOT NULL,
            error TEXT,
            runner_result_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );",
    )?;
    Ok(connection)
}

fn db_list_pending_drafts() -> Result<Vec<PendingDraft>, Box<dyn std::error::Error>> {
    let connection = open_local_database()?;
    let mut statement = connection.prepare(
        "SELECT id, profile_id, server_url, channel_id, agent_config_id, agent_name,
                triggering_message_id, body, status, error, runner_result_json, created_at, updated_at
         FROM pending_drafts
         ORDER BY created_at ASC",
    )?;
    let rows = statement.query_map([], pending_draft_from_row)?;
    let mut drafts = Vec::new();
    for row in rows {
        drafts.push(row?);
    }
    Ok(drafts)
}

fn db_create_pending_draft(
    input: PendingDraftInput,
) -> Result<PendingDraft, Box<dyn std::error::Error>> {
    let connection = open_local_database()?;
    let now = unix_now_millis_i64();
    let id = format!("draft-{}", unix_now_nanos());
    let runner_result_json = input
        .runner_result
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    connection.execute(
        "INSERT INTO pending_drafts (
            id, profile_id, server_url, channel_id, agent_config_id, agent_name,
            triggering_message_id, body, status, error, runner_result_json, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            id,
            input.profile_id,
            input.server_url,
            input.channel_id,
            input.agent_config_id,
            input.agent_name,
            input.triggering_message_id,
            input.body,
            input.status,
            input.error,
            runner_result_json,
            now,
            now
        ],
    )?;
    db_get_pending_draft(&connection, &id)
}

fn db_update_pending_draft_body(
    id: &str,
    body: &str,
) -> Result<PendingDraft, Box<dyn std::error::Error>> {
    let connection = open_local_database()?;
    connection.execute(
        "UPDATE pending_drafts SET body = ?1, updated_at = ?2 WHERE id = ?3",
        params![body, unix_now_millis_i64(), id],
    )?;
    db_get_pending_draft(&connection, id)
}

fn db_delete_pending_draft(id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let connection = open_local_database()?;
    connection.execute("DELETE FROM pending_drafts WHERE id = ?1", [id])?;
    Ok(())
}

fn db_get_pending_draft(
    connection: &Connection,
    id: &str,
) -> Result<PendingDraft, Box<dyn std::error::Error>> {
    Ok(connection.query_row(
        "SELECT id, profile_id, server_url, channel_id, agent_config_id, agent_name,
                triggering_message_id, body, status, error, runner_result_json, created_at, updated_at
         FROM pending_drafts
         WHERE id = ?1",
        [id],
        pending_draft_from_row,
    )?)
}

fn pending_draft_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PendingDraft> {
    let runner_result_json: Option<String> = row.get(10)?;
    let runner_result = runner_result_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    Ok(PendingDraft {
        id: row.get(0)?,
        profile_id: row.get(1)?,
        server_url: row.get(2)?,
        channel_id: row.get(3)?,
        agent_config_id: row.get(4)?,
        agent_name: row.get(5)?,
        triggering_message_id: row.get(6)?,
        body: row.get(7)?,
        status: row.get(8)?,
        error: row.get(9)?,
        runner_result,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn make_profile_id() -> String {
    format!("profile-{}", unix_now_millis())
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_secs() as i64
}

fn unix_now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_millis()
}

fn unix_now_millis_i64() -> i64 {
    unix_now_millis() as i64
}

fn unix_now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos()
}

fn credential_name(profile_id: &str) -> String {
    format!("{CREDENTIAL_PREFIX} {profile_id}")
}

#[cfg(windows)]
fn write_token(profile_id: &str, token: &str) -> Result<(), String> {
    use std::{mem, ptr};
    use windows_sys::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let target_name = wide_null(&credential_name(profile_id));
    let mut username = wide_null("agentparty");
    let secret = token.as_bytes();
    let mut credential = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: target_name.as_ptr() as *mut _,
        Comment: ptr::null_mut(),
        LastWritten: unsafe { mem::zeroed() },
        CredentialBlobSize: secret.len() as u32,
        CredentialBlob: secret.as_ptr() as *mut _,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: ptr::null_mut(),
        TargetAlias: ptr::null_mut(),
        UserName: username.as_mut_ptr(),
    };

    let ok = unsafe { CredWriteW(&mut credential, 0) };
    if ok == 0 {
        Err("failed to write token to Windows Credential Manager".to_string())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn read_token(profile_id: &str) -> Result<String, String> {
    use std::{ptr, slice};
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    let target_name = wide_null(&credential_name(profile_id));
    let mut credential: *mut CREDENTIALW = ptr::null_mut();
    let ok = unsafe { CredReadW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
    if ok == 0 || credential.is_null() {
        return Err("profile token is missing from Windows Credential Manager".to_string());
    }

    let result = unsafe {
        let blob = slice::from_raw_parts(
            (*credential).CredentialBlob,
            (*credential).CredentialBlobSize as usize,
        );
        String::from_utf8(blob.to_vec()).map_err(|_| "stored token is not valid UTF-8".to_string())
    };
    unsafe { CredFree(credential as *const _) };
    result
}

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(not(windows))]
fn write_token(_profile_id: &str, _token: &str) -> Result<(), String> {
    Err("system keyring storage is only implemented for Windows in this slice".to_string())
}

#[cfg(not(windows))]
fn read_token(_profile_id: &str) -> Result<String, String> {
    Err("system keyring storage is only implemented for Windows in this slice".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static TEST_MUTEX: Mutex<()> = Mutex::new(());

    #[test]
    fn fake_runner_writes_context_file_and_log_result() {
        let _guard = TEST_MUTEX.lock().expect("test lock poisoned");
        let root =
            std::env::temp_dir().join(format!("agentparty-desktop-test-{}", unix_now_millis()));
        std::env::set_var("AGENTPARTY_DESKTOP_DATA_DIR", &root);
        let workdir = root.join("workdir");
        let config = LocalAgentConfig {
            id: "agent-1".to_string(),
            name: "bot".to_string(),
            channel_id: "chan-1".to_string(),
            runner_kind: RunnerKind::Fake,
            custom_command: None,
            workdir: workdir.to_string_lossy().to_string(),
            workdir_mode: WorkdirMode::ReadOnly,
            sending_policy: SendingPolicy::Draft,
            created_at: 1,
            updated_at: 1,
        };
        let context = serde_json::json!({
            "channel": { "id": "chan-1" },
            "triggeringMessage": {
                "id": "msg-1",
                "body": "please help"
            },
            "sender": { "owner_label": "Ada" },
            "replyTarget": null,
            "mentions": ["bot"],
            "recentMessages": [],
            "protocolReminder": "return a draft"
        });

        let result = run_fake_runner(config, context).expect("fake runner should succeed");

        assert_eq!(result.status, "done");
        assert_eq!(result.exit_code, 0);
        assert!(result.draft_reply.contains("please help"));
        assert!(PathBuf::from(&result.context_file_path).exists());
        let logs = read_runner_logs().expect("runner logs should be readable");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].triggering_message_id, "msg-1");
        std::env::remove_var("AGENTPARTY_DESKTOP_DATA_DIR");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_runner_normalizes_fake_process_success() {
        let _guard = TEST_MUTEX.lock().expect("test lock poisoned");
        let root =
            std::env::temp_dir().join(format!("agentparty-desktop-test-{}", unix_now_millis()));
        std::env::set_var("AGENTPARTY_DESKTOP_DATA_DIR", &root);
        let workdir = root.join("workdir");
        let config = LocalAgentConfig {
            id: "agent-1".to_string(),
            name: "bot".to_string(),
            channel_id: "chan-1".to_string(),
            runner_kind: RunnerKind::Codex,
            custom_command: None,
            workdir: workdir.to_string_lossy().to_string(),
            workdir_mode: WorkdirMode::ReadOnly,
            sending_policy: SendingPolicy::Draft,
            created_at: 1,
            updated_at: 1,
        };
        let context = serde_json::json!({
            "triggeringMessage": {
                "id": "msg-1",
                "body": "please help"
            }
        });

        let result = run_codex_runner_with_executor(config, context, |context_path, final_path| {
            assert!(context_path.exists());
            fs::write(final_path, "draft from codex\n").expect("final message should write");
            Ok(CodexProcessOutput {
                stdout: "{\"type\":\"session.started\",\"session_id\":\"sess-1\"}\n".to_string(),
                stderr: "useful warning".to_string(),
                exit_code: 0,
            })
        })
        .expect("codex runner should normalize success");

        assert_eq!(result.status, "done");
        assert_eq!(result.draft_reply, "draft from codex");
        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("sess-1"));
        assert!(result.stdout.contains("[codex session_ids: sess-1]"));
        let logs = read_runner_logs().expect("runner logs should be readable");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].draft_reply, "draft from codex");
        std::env::remove_var("AGENTPARTY_DESKTOP_DATA_DIR");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_runner_normalizes_fake_process_failure_as_blocked() {
        let _guard = TEST_MUTEX.lock().expect("test lock poisoned");
        let root =
            std::env::temp_dir().join(format!("agentparty-desktop-test-{}", unix_now_millis()));
        std::env::set_var("AGENTPARTY_DESKTOP_DATA_DIR", &root);
        let workdir = root.join("workdir");
        let config = LocalAgentConfig {
            id: "agent-1".to_string(),
            name: "bot".to_string(),
            channel_id: "chan-1".to_string(),
            runner_kind: RunnerKind::Codex,
            custom_command: None,
            workdir: workdir.to_string_lossy().to_string(),
            workdir_mode: WorkdirMode::ReadOnly,
            sending_policy: SendingPolicy::Draft,
            created_at: 1,
            updated_at: 1,
        };
        let context = serde_json::json!({
            "triggeringMessage": {
                "id": "msg-1",
                "body": "please help"
            }
        });

        let result =
            run_codex_runner_with_executor(config, context, |_context_path, _final_path| {
                Ok(CodexProcessOutput {
                    stdout: "{\"type\":\"session.started\",\"session_id\":\"sess-1\"}\n"
                        .to_string(),
                    stderr: "model failed".to_string(),
                    exit_code: 2,
                })
            })
            .expect("codex runner should return blocked result");

        assert_eq!(result.status, "blocked");
        assert_eq!(result.draft_reply, "");
        assert_eq!(result.stderr, "model failed");
        assert_eq!(result.exit_code, 2);
        let logs = read_runner_logs().expect("runner logs should be readable");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].status, "blocked");
        std::env::remove_var("AGENTPARTY_DESKTOP_DATA_DIR");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn custom_command_runner_turns_stdout_into_draft_and_logs_stderr() {
        let _guard = TEST_MUTEX.lock().expect("test lock poisoned");
        let root =
            std::env::temp_dir().join(format!("agentparty-desktop-test-{}", unix_now_millis()));
        std::env::set_var("AGENTPARTY_DESKTOP_DATA_DIR", &root);
        let workdir = root.join("workdir");
        let config = LocalAgentConfig {
            id: "agent-1".to_string(),
            name: "bot".to_string(),
            channel_id: "chan-1".to_string(),
            runner_kind: RunnerKind::CustomCommand,
            custom_command: Some("example-runner --flag".to_string()),
            workdir: workdir.to_string_lossy().to_string(),
            workdir_mode: WorkdirMode::ReadOnly,
            sending_policy: SendingPolicy::Draft,
            created_at: 1,
            updated_at: 1,
        };
        let context = serde_json::json!({
            "triggeringMessage": {
                "id": "msg-1",
                "body": "please help"
            }
        });

        let result = run_custom_command_runner_with_executor(config, context, |request| {
            assert_eq!(request.command, "example-runner --flag");
            assert!(request.context_file_path.exists());
            assert_eq!(
                request.env.get("AP_CONTEXT_FILE").map(String::as_str),
                Some(request.context_file_path.to_string_lossy().as_ref())
            );
            assert_eq!(request.stdin, "please help");
            Ok(CustomCommandProcessOutput {
                stdout: "draft from custom\n".to_string(),
                stderr: "diagnostic only".to_string(),
                exit_code: 0,
            })
        })
        .expect("custom command runner should normalize success");

        assert_eq!(result.status, "done");
        assert_eq!(result.draft_reply, "draft from custom");
        assert_eq!(result.stderr, "diagnostic only");
        assert_eq!(result.exit_code, 0);
        let logs = read_runner_logs().expect("runner logs should be readable");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].draft_reply, "draft from custom");
        assert_eq!(logs[0].stderr, "diagnostic only");
        std::env::remove_var("AGENTPARTY_DESKTOP_DATA_DIR");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn custom_command_runner_nonzero_exit_returns_blocked_result() {
        let _guard = TEST_MUTEX.lock().expect("test lock poisoned");
        let root =
            std::env::temp_dir().join(format!("agentparty-desktop-test-{}", unix_now_millis()));
        std::env::set_var("AGENTPARTY_DESKTOP_DATA_DIR", &root);
        let workdir = root.join("workdir");
        let config = LocalAgentConfig {
            id: "agent-1".to_string(),
            name: "bot".to_string(),
            channel_id: "chan-1".to_string(),
            runner_kind: RunnerKind::CustomCommand,
            custom_command: Some("failing-runner".to_string()),
            workdir: workdir.to_string_lossy().to_string(),
            workdir_mode: WorkdirMode::ReadOnly,
            sending_policy: SendingPolicy::Draft,
            created_at: 1,
            updated_at: 1,
        };
        let context = serde_json::json!({
            "triggeringMessage": {
                "id": "msg-1",
                "body": "please help"
            }
        });

        let result = run_custom_command_runner_with_executor(config, context, |_request| {
            Ok(CustomCommandProcessOutput {
                stdout: "do not post this".to_string(),
                stderr: "tool failed".to_string(),
                exit_code: 12,
            })
        })
        .expect("custom command runner should return blocked result");

        assert_eq!(result.status, "blocked");
        assert_eq!(result.draft_reply, "");
        assert_eq!(result.stdout, "do not post this");
        assert_eq!(result.stderr, "tool failed");
        assert_eq!(result.exit_code, 12);
        let logs = read_runner_logs().expect("runner logs should be readable");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].status, "blocked");
        std::env::remove_var("AGENTPARTY_DESKTOP_DATA_DIR");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn custom_command_runner_missing_command_returns_blocked_result() {
        let _guard = TEST_MUTEX.lock().expect("test lock poisoned");
        let root =
            std::env::temp_dir().join(format!("agentparty-desktop-test-{}", unix_now_millis()));
        std::env::set_var("AGENTPARTY_DESKTOP_DATA_DIR", &root);
        let workdir = root.join("workdir");
        let config = LocalAgentConfig {
            id: "agent-1".to_string(),
            name: "bot".to_string(),
            channel_id: "chan-1".to_string(),
            runner_kind: RunnerKind::CustomCommand,
            custom_command: None,
            workdir: workdir.to_string_lossy().to_string(),
            workdir_mode: WorkdirMode::ReadOnly,
            sending_policy: SendingPolicy::Draft,
            created_at: 1,
            updated_at: 1,
        };
        let context = serde_json::json!({
            "triggeringMessage": {
                "id": "msg-1",
                "body": "please help"
            }
        });

        let result = run_custom_command_runner_with_executor(config, context, |_request| {
            panic!("missing custom command should not execute");
        })
        .expect("custom command runner should return blocked result");

        assert_eq!(result.status, "blocked");
        assert_eq!(result.draft_reply, "");
        assert_eq!(result.stderr, "Custom command is required");
        assert_eq!(result.exit_code, 1);
        std::env::remove_var("AGENTPARTY_DESKTOP_DATA_DIR");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pending_drafts_persist_in_local_sqlite() {
        let _guard = TEST_MUTEX.lock().expect("test lock poisoned");
        let root =
            std::env::temp_dir().join(format!("agentparty-desktop-test-{}", unix_now_millis()));
        std::env::set_var("AGENTPARTY_DESKTOP_DATA_DIR", &root);

        let draft = create_pending_draft(PendingDraftInput {
            profile_id: "profile-1".to_string(),
            server_url: "http://127.0.0.1:4180".to_string(),
            channel_id: "chan-1".to_string(),
            agent_config_id: "agent-1".to_string(),
            agent_name: "bot".to_string(),
            triggering_message_id: "msg-1".to_string(),
            body: "draft body".to_string(),
            status: "pending".to_string(),
            error: None,
            runner_result: Some(serde_json::json!({
                "status": "done",
                "draftReply": "draft body",
                "stdout": "ok",
                "stderr": "",
                "exitCode": 0,
                "contextFilePath": "context.json"
            })),
        })
        .expect("pending draft should be created");

        let listed = list_pending_drafts().expect("pending drafts should list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].body, "draft body");
        assert!(listed[0].runner_result.is_some());

        let edited = update_pending_draft_body(draft.id.clone(), "edited".to_string())
            .expect("pending draft should update");
        assert_eq!(edited.body, "edited");

        delete_pending_draft(draft.id).expect("pending draft should delete");
        assert!(list_pending_drafts()
            .expect("pending drafts should list")
            .is_empty());

        std::env::remove_var("AGENTPARTY_DESKTOP_DATA_DIR");
        let _ = fs::remove_dir_all(root);
    }
}
