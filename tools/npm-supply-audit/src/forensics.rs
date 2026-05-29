use anyhow::Result;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

// Indicators of compromise (filenames) seen across Shai-Hulud / Mini Shai-Hulud reports.
// Sources: Snyk, StepSecurity, Unit42, Microsoft Security Blog (2026-05).
const IOC_FILENAMES: &[&str] = &[
    "router_runtime.js",
    "setup.mjs",
    "shai-hulud.json",
    "shai-hulud-workflow.yml",
    "bun_environment.js",
    "processor.js",
];

const SKIP_DIRS: &[&str] = &["node_modules", "target", ".git"];

pub fn scan_ioc_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut found = Vec::new();
    let walker = WalkDir::new(root).into_iter().filter_entry(|e| {
        if !e.file_type().is_dir() {
            return true;
        }
        let n = e.file_name().to_string_lossy();
        !SKIP_DIRS.iter().any(|s| *s == n)
    });
    for entry in walker.filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if IOC_FILENAMES.iter().any(|ioc| *ioc == name) {
            found.push(entry.into_path());
        }
    }
    Ok(found)
}

pub fn scan_claude_hooks() -> Result<Vec<String>> {
    let home = match std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        Ok(h) => PathBuf::from(h),
        Err(_) => return Ok(Vec::new()),
    };
    let settings = home.join(".claude").join("settings.json");
    if !settings.exists() {
        return Ok(Vec::new());
    }

    let body = std::fs::read_to_string(&settings)?;
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return Ok(vec!["~/.claude/settings.json is not valid JSON".into()]),
    };

    let mut suspicious = Vec::new();
    if let Some(hooks) = v.get("hooks") {
        let serialized = hooks.to_string();
        for ioc in IOC_FILENAMES {
            if serialized.contains(ioc) {
                suspicious.push(format!("hooks reference IOC file: {ioc}"));
            }
        }
        let lowered = serialized.to_lowercase();
        if lowered.contains("curl ")
            && (lowered.contains("| sh") || lowered.contains("|sh") || lowered.contains("| bash"))
        {
            suspicious.push("hooks contain a `curl | sh` style command".into());
        }
        if lowered.contains("iwr ") && lowered.contains("iex") {
            suspicious.push("hooks contain a `iwr ... | iex` style command".into());
        }
    }
    Ok(suspicious)
}
