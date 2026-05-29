use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const SKIP_DIRS: &[&str] = &["node_modules", "target", ".git", "dist", "build"];

pub fn find(root: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
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
        if matches!(
            name.as_ref(),
            "pnpm-lock.yaml" | "package-lock.json" | "yarn.lock" | "bun.lock"
        ) {
            out.push(entry.into_path());
        }
    }
    Ok(out)
}

pub fn parse(path: &Path) -> Result<Vec<(String, String)>> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let body =
        std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    parse_str(&name, &body)
}

pub fn parse_str(filename: &str, body: &str) -> Result<Vec<(String, String)>> {
    match filename {
        "pnpm-lock.yaml" => parse_pnpm(body),
        "package-lock.json" => parse_npm(body),
        "yarn.lock" => parse_yarn(body),
        "bun.lock" => parse_bun(body),
        _ => Ok(Vec::new()),
    }
}

pub fn is_lockfile_name(name: &str) -> bool {
    matches!(
        name,
        "pnpm-lock.yaml" | "package-lock.json" | "yarn.lock" | "bun.lock"
    )
}

#[derive(Deserialize)]
struct PnpmLock {
    #[serde(default)]
    packages: BTreeMap<String, serde_yml::Value>,
    #[serde(default)]
    snapshots: BTreeMap<String, serde_yml::Value>,
}

fn parse_pnpm(body: &str) -> Result<Vec<(String, String)>> {
    let lock: PnpmLock = serde_yml::from_str(body).context("parse pnpm-lock.yaml")?;
    let source = if !lock.snapshots.is_empty() {
        &lock.snapshots
    } else {
        &lock.packages
    };
    let mut out = Vec::new();
    for key in source.keys() {
        if let Some(pair) = parse_pnpm_key(key) {
            out.push(pair);
        }
    }
    Ok(out)
}

// Keys come in shapes like:
//   "/@scope/name@1.2.3"
//   "/name@1.2.3"
//   "@scope/name@1.2.3(react@18.0.0)"
//   "name@1.2.3"
fn parse_pnpm_key(key: &str) -> Option<(String, String)> {
    let s = key.trim_start_matches('/');
    let s = s.split('(').next().unwrap_or(s);
    let at = s.rfind('@')?;
    if at == 0 {
        return None;
    }
    let name = &s[..at];
    let version = &s[at + 1..];
    if name.is_empty() || version.is_empty() {
        return None;
    }
    // Skip non-registry versions (file:, link:, git+...)
    if version.contains(':') || version.starts_with("http") {
        return None;
    }
    Some((name.to_string(), version.to_string()))
}

#[derive(Deserialize)]
struct NpmLock {
    #[serde(default)]
    packages: BTreeMap<String, NpmLockEntry>,
    #[serde(default)]
    dependencies: BTreeMap<String, NpmLockDep>,
}

#[derive(Deserialize)]
struct NpmLockEntry {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
}

#[derive(Deserialize)]
struct NpmLockDep {
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    dependencies: BTreeMap<String, NpmLockDep>,
}

fn parse_npm(body: &str) -> Result<Vec<(String, String)>> {
    let lock: NpmLock = serde_json::from_str(body).context("parse package-lock.json")?;
    let mut out = Vec::new();

    // npm v7+ format: "packages" keyed by install path
    for (path, entry) in &lock.packages {
        if path.is_empty() {
            continue;
        }
        let name = entry.name.clone().or_else(|| {
            path.rsplit("node_modules/")
                .next()
                .filter(|s| !s.is_empty())
                .map(String::from)
        });
        if let (Some(n), Some(v)) = (name, entry.version.clone()) {
            if !v.contains(':') && !v.starts_with("http") {
                out.push((n, v));
            }
        }
    }

    // npm v6 fallback: nested "dependencies"
    if out.is_empty() {
        fn walk(deps: &BTreeMap<String, NpmLockDep>, out: &mut Vec<(String, String)>) {
            for (name, dep) in deps {
                if let Some(v) = &dep.version {
                    if !v.contains(':') && !v.starts_with("http") {
                        out.push((name.clone(), v.clone()));
                    }
                }
                walk(&dep.dependencies, out);
            }
        }
        walk(&lock.dependencies, &mut out);
    }

    Ok(out)
}

// ---- yarn.lock (v1 classic + berry v2+) --------------------------------------

fn parse_yarn(body: &str) -> Result<Vec<(String, String)>> {
    let mut out = Vec::new();
    let mut current_keys: Vec<String> = Vec::new();
    for line in body.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let is_top = !line.starts_with([' ', '\t']);
        if is_top && line.trim_end().ends_with(':') {
            let key_line = line.trim_end().trim_end_matches(':').trim();
            current_keys = key_line
                .split(", ")
                .map(|k| k.trim_matches('"').to_string())
                .collect();
            continue;
        }
        let trimmed = line.trim_start();
        // matches both v1 (`version "1.2.3"`) and berry (`version: 1.2.3`)
        if let Some(rest) = trimmed.strip_prefix("version") {
            let rest = rest.trim_start_matches(':').trim();
            let version = rest.trim_matches('"');
            if version.is_empty() {
                continue;
            }
            for k in &current_keys {
                if let Some(name) = parse_yarn_key_name(k) {
                    out.push((name, version.to_string()));
                }
            }
            current_keys.clear();
        }
    }
    Ok(out)
}

// Handles "@scope/name@^1.0", "lodash@^4.0", "@scope/name@npm:^1.0", "foo@workspace:*"
fn parse_yarn_key_name(key: &str) -> Option<String> {
    let s = key.trim_matches('"');
    let at = if let Some(stripped) = s.strip_prefix('@') {
        stripped.find('@').map(|p| p + 1)?
    } else {
        s.find('@')?
    };
    let name = &s[..at];
    let range = &s[at + 1..];
    if range.starts_with("workspace:")
        || range.starts_with("patch:")
        || range.starts_with("portal:")
        || range.starts_with("link:")
        || range.starts_with("file:")
        || range.starts_with("git+")
        || range.starts_with("http")
    {
        return None;
    }
    if name.is_empty() {
        return None;
    }
    Some(name.to_string())
}

// ---- bun.lock (JSONC) --------------------------------------------------------

#[derive(Deserialize)]
struct BunLock {
    #[serde(default)]
    packages: BTreeMap<String, serde_json::Value>,
}

fn parse_bun(body: &str) -> Result<Vec<(String, String)>> {
    let lock: BunLock =
        json5::from_str(body).map_err(|e| anyhow::anyhow!("parse bun.lock: {e}"))?;
    let mut out = Vec::new();
    for value in lock.packages.values() {
        let spec = value
            .as_array()
            .and_then(|a| a.first())
            .and_then(|v| v.as_str());
        if let Some(s) = spec {
            if let Some(pair) = parse_bun_spec(s) {
                out.push(pair);
            }
        }
    }
    Ok(out)
}

// "@scope/name@1.2.3", "name@1.2.3", "name@npm:1.2.3"
fn parse_bun_spec(s: &str) -> Option<(String, String)> {
    let at = if let Some(stripped) = s.strip_prefix('@') {
        stripped.rfind('@').map(|p| p + 1)?
    } else {
        s.rfind('@')?
    };
    let name = &s[..at];
    let mut version = &s[at + 1..];
    if let Some(rest) = version.strip_prefix("npm:") {
        version = rest;
    }
    if name.is_empty() || version.is_empty() {
        return None;
    }
    if version.contains(':') || version.starts_with("http") || version.starts_with("workspace") {
        return None;
    }
    Some((name.to_string(), version.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pnpm_key_scoped() {
        assert_eq!(
            parse_pnpm_key("/@antv/g2@5.2.0"),
            Some(("@antv/g2".into(), "5.2.0".into()))
        );
    }

    #[test]
    fn pnpm_key_with_peer_suffix() {
        assert_eq!(
            parse_pnpm_key("@tanstack/react-query@5.90.20(react@19.0.0)"),
            Some(("@tanstack/react-query".into(), "5.90.20".into()))
        );
    }

    #[test]
    fn pnpm_key_plain() {
        assert_eq!(
            parse_pnpm_key("timeago.js@4.0.2"),
            Some(("timeago.js".into(), "4.0.2".into()))
        );
    }

    #[test]
    fn pnpm_key_rejects_link() {
        assert_eq!(parse_pnpm_key("/foo@link:../bar"), None);
    }

    #[test]
    fn yarn_key_v1_scoped() {
        assert_eq!(
            parse_yarn_key_name("@babel/code-frame@^7.0.0"),
            Some("@babel/code-frame".into())
        );
    }

    #[test]
    fn yarn_key_berry_npm_protocol() {
        assert_eq!(
            parse_yarn_key_name("\"@tanstack/react-query@npm:^5.0.0\""),
            Some("@tanstack/react-query".into())
        );
    }

    #[test]
    fn yarn_key_rejects_workspace() {
        assert_eq!(parse_yarn_key_name("foo@workspace:packages/foo"), None);
        assert_eq!(parse_yarn_key_name("\"foo@patch:bar@1.0.0#./fix.patch\""), None);
    }

    #[test]
    fn yarn_v1_full_block() {
        let body = r#"# yarn lockfile v1

"@babel/code-frame@^7.0.0", "@babel/code-frame@^7.10.4":
  version "7.10.4"
  resolved "https://registry.yarnpkg.com/..."
  integrity sha512-...

lodash@^4.17.21:
  version "4.17.21"
  resolved "..."
"#;
        let mut deps = parse_yarn(body).unwrap();
        deps.sort();
        assert_eq!(
            deps,
            vec![
                ("@babel/code-frame".into(), "7.10.4".into()),
                ("@babel/code-frame".into(), "7.10.4".into()),
                ("lodash".into(), "4.17.21".into()),
            ]
        );
    }

    #[test]
    fn yarn_berry_full_block() {
        let body = r#"# This file is generated by running "yarn install" inside your project.

__metadata:
  version: 6
  cacheKey: 8

"@babel/code-frame@npm:^7.0.0":
  version: 7.10.4
  resolution: "@babel/code-frame@npm:7.10.4"
"#;
        let deps = parse_yarn(body).unwrap();
        assert_eq!(deps, vec![("@babel/code-frame".into(), "7.10.4".into())]);
    }

    #[test]
    fn bun_spec_scoped() {
        assert_eq!(
            parse_bun_spec("@tanstack/react-query@5.90.20"),
            Some(("@tanstack/react-query".into(), "5.90.20".into()))
        );
    }

    #[test]
    fn bun_spec_npm_prefix() {
        assert_eq!(
            parse_bun_spec("lodash@npm:4.17.21"),
            Some(("lodash".into(), "4.17.21".into()))
        );
    }

    #[test]
    fn bun_spec_rejects_workspace() {
        assert_eq!(parse_bun_spec("foo@workspace:packages/foo"), None);
    }

    #[test]
    fn bun_lock_with_trailing_commas() {
        let body = r#"{
  "lockfileVersion": 1,
  "packages": {
    "@ctrl/tinycolor": ["@ctrl/tinycolor@4.1.1", "", {}, "sha512-x"],
    "lodash": ["lodash@4.17.21", "", {}, "sha512-y"],
  },
}"#;
        let mut deps = parse_bun(body).unwrap();
        deps.sort();
        assert_eq!(
            deps,
            vec![
                ("@ctrl/tinycolor".into(), "4.1.1".into()),
                ("lodash".into(), "4.17.21".into()),
            ]
        );
    }
}
