use serde::{Deserialize, Serialize};
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_server_profiles,
            save_server_profile,
            get_server_profile_token
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
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join(APP_DIR);
    fs::create_dir_all(&dir)?;
    Ok(dir.join("profiles.json"))
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
