use anyhow::{Context, Result};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::lockfile;

pub struct DiffProject {
    pub lockfile: PathBuf,
    // (name, version) pairs present in HEAD lockfile but absent from base_ref.
    // Covers both newly added packages and version upgrades of existing ones.
    pub introduced: Vec<(String, String)>,
}

pub fn collect_changes(root: &Path, base_ref: &str) -> Result<Vec<DiffProject>> {
    let git_root = git_toplevel(root)?;
    let changed = git_diff_lockfiles(&git_root, base_ref)?;

    let mut out = Vec::new();
    for rel in changed {
        let abs = git_root.join(&rel);

        let new_body = std::fs::read_to_string(&abs).unwrap_or_default();
        let old_body = git_show(&git_root, base_ref, &rel).unwrap_or_default();

        let name = abs
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();

        let new_deps = lockfile::parse_str(name, &new_body).unwrap_or_default();
        let old_deps: BTreeSet<(String, String)> = lockfile::parse_str(name, &old_body)
            .unwrap_or_default()
            .into_iter()
            .collect();

        let mut introduced: Vec<(String, String)> = new_deps
            .into_iter()
            .filter(|d| !old_deps.contains(d))
            .collect();
        introduced.sort();
        introduced.dedup();

        out.push(DiffProject {
            lockfile: abs,
            introduced,
        });
    }
    Ok(out)
}

fn git_toplevel(root: &Path) -> Result<PathBuf> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .context("invoke git")?;
    if !out.status.success() {
        anyhow::bail!(
            "not a git repository at {} (git: {})",
            root.display(),
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let s = String::from_utf8(out.stdout)?.trim().to_string();
    Ok(PathBuf::from(s))
}

fn git_diff_lockfiles(git_root: &Path, base_ref: &str) -> Result<Vec<String>> {
    let out = Command::new("git")
        .arg("-C")
        .arg(git_root)
        .args(["diff", "--name-only", &format!("{base_ref}..HEAD")])
        .output()
        .context("invoke git diff")?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        anyhow::bail!("git diff {base_ref}..HEAD failed: {stderr}");
    }
    let s = String::from_utf8(out.stdout)?;
    let lockfiles: Vec<String> = s
        .lines()
        .filter(|l| {
            Path::new(l)
                .file_name()
                .and_then(|n| n.to_str())
                .map(lockfile::is_lockfile_name)
                .unwrap_or(false)
        })
        .map(String::from)
        .collect();
    Ok(lockfiles)
}

fn git_show(git_root: &Path, base_ref: &str, rel_path: &str) -> Result<String> {
    let spec = format!("{base_ref}:{rel_path}");
    let out = Command::new("git")
        .arg("-C")
        .arg(git_root)
        .args(["show", &spec])
        .output()
        .context("invoke git show")?;
    if !out.status.success() {
        anyhow::bail!("path not present at {base_ref}");
    }
    Ok(String::from_utf8(out.stdout)?)
}
