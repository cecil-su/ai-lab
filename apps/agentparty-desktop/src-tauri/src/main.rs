use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf};

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
    workdir: String,
    sending_policy: SendingPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalAgentConfig {
    id: String,
    name: String,
    channel_id: String,
    runner_kind: RunnerKind,
    workdir: String,
    sending_policy: SendingPolicy,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum RunnerKind {
    Fake,
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
        created_at: existing.as_ref().map(|profile| profile.created_at).unwrap_or(now),
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
    let id = input.id.unwrap_or_else(|| format!("agent-{}", unix_now_millis()));
    let existing = configs.iter().find(|config| config.id == id).cloned();
    let config = LocalAgentConfig {
        id: id.clone(),
        name: input.name.trim().to_string(),
        channel_id: input.channel_id.trim().to_string(),
        runner_kind: input.runner_kind,
        workdir: input.workdir.trim().to_string(),
        sending_policy: input.sending_policy,
        created_at: existing.as_ref().map(|config| config.created_at).unwrap_or(now),
        updated_at: now,
    };

    configs.retain(|item| item.id != id);
    configs.push(config.clone());
    configs.sort_by_key(|item| item.created_at);
    write_agent_configs(&configs).map_err(|error| error.to_string())?;
    Ok(config)
}

#[tauri::command]
fn run_fake_runner(agent_config: LocalAgentConfig, context: Value) -> Result<RunnerResult, String> {
    let message = context
        .get("triggeringMessage")
        .ok_or_else(|| "runner context missing triggeringMessage".to_string())?;
    let triggering_message_id = message
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "runner context missing triggeringMessage.id".to_string())?;
    let body = message.get("body").and_then(Value::as_str).unwrap_or("");
    let workdir = PathBuf::from(&agent_config.workdir);
    fs::create_dir_all(&workdir).map_err(|error| error.to_string())?;
    let context_file_path = workdir.join(format!("runner-context-{triggering_message_id}.json"));
    let context_json = serde_json::to_string_pretty(&context).map_err(|error| error.to_string())?;
    fs::write(&context_file_path, context_json).map_err(|error| error.to_string())?;

    let result = RunnerResult {
        status: "done".to_string(),
        draft_reply: format!("Fake runner {} saw: {}", agent_config.name, body),
        stdout: format!("fake runner handled {triggering_message_id}"),
        stderr: String::new(),
        exit_code: 0,
        context_file_path: context_file_path.to_string_lossy().to_string(),
    };
    append_runner_log(RunnerLogEntry {
        id: format!("log-{}", unix_now_millis()),
        agent_config_id: agent_config.id,
        triggering_message_id: triggering_message_id.to_string(),
        created_at: unix_now(),
        status: result.status.clone(),
        draft_reply: result.draft_reply.clone(),
        stdout: result.stdout.clone(),
        stderr: result.stderr.clone(),
        exit_code: result.exit_code,
        context_file_path: result.context_file_path.clone(),
    })
    .map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
fn list_runner_logs() -> Result<Vec<RunnerLogEntry>, String> {
    read_runner_logs().map_err(|error| error.to_string())
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
            list_runner_logs
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

fn credential_name(profile_id: &str) -> String {
    format!("{CREDENTIAL_PREFIX} {profile_id}")
}

#[cfg(windows)]
fn write_token(profile_id: &str, token: &str) -> Result<(), String> {
    use std::{mem, ptr};
    use windows_sys::Win32::Security::Credentials::{CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC};

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
    use windows_sys::Win32::Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};

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

    #[test]
    fn fake_runner_writes_context_file_and_log_result() {
        let root = std::env::temp_dir().join(format!("agentparty-desktop-test-{}", unix_now_millis()));
        std::env::set_var("AGENTPARTY_DESKTOP_DATA_DIR", &root);
        let workdir = root.join("workdir");
        let config = LocalAgentConfig {
            id: "agent-1".to_string(),
            name: "bot".to_string(),
            channel_id: "chan-1".to_string(),
            runner_kind: RunnerKind::Fake,
            workdir: workdir.to_string_lossy().to_string(),
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
}
