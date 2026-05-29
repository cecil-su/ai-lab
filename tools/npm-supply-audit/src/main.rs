mod allowlist;
mod diff;
mod forensics;
mod heuristic;
mod lockfile;
mod osv;
mod registry;
mod scriptdrift;

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

struct ProjectResult {
    lockfile: PathBuf,
    deps: Vec<(String, String)>,
    parse_error: Option<String>,
    vulns: Vec<osv::Vuln>,
}

#[derive(Parser)]
#[command(
    about = "Local self-check for Shai-Hulud / Mini Shai-Hulud npm supply-chain compromises",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Audit {
        #[arg(default_value = ".")]
        path: PathBuf,
        #[arg(long, help = "Emit JSON instead of human-readable text")]
        json: bool,
        #[arg(long, help = "Skip OSV network query; only run filesystem checks")]
        offline: bool,
        #[arg(
            long,
            help = "Only report MAL-* findings (malicious packages); suppress GHSA-* CVE noise"
        )]
        only_malicious: bool,
        #[arg(
            long,
            help = "Detect Shai-Hulud-style burst publishing (maintainer published >=N packages in a tight window)"
        )]
        suspicious_publishing: bool,
        #[arg(long, default_value_t = 30, help = "Burst window in minutes (with --suspicious-publishing)")]
        window_minutes: i64,
        #[arg(long, default_value_t = 10, help = "Min distinct packages per window to flag a burst")]
        burst_threshold: usize,
        #[arg(
            long,
            help = "Flag pinned versions that introduce an install hook (pre/post/install) absent in the prior published version"
        )]
        script_drift: bool,
    },
    /// Scan only what changed in the lockfile since a git ref (default HEAD~1).
    /// Suitable for pre-commit hooks and CI PR gates.
    Diff {
        #[arg(default_value = "HEAD~1")]
        git_ref: String,
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long, help = "Emit JSON instead of human-readable text")]
        json: bool,
        #[arg(long, help = "Skip OSV network query")]
        offline: bool,
        #[arg(long, help = "Only report MAL-* findings")]
        only_malicious: bool,
        #[arg(long, help = "Detect Shai-Hulud-style burst publishing on introduced deps")]
        suspicious_publishing: bool,
        #[arg(long, default_value_t = 30)]
        window_minutes: i64,
        #[arg(long, default_value_t = 10)]
        burst_threshold: usize,
        #[arg(
            long,
            help = "Flag introduced versions that add an install hook absent in the prior published version"
        )]
        script_drift: bool,
    },
    /// Print the OSV advisory for an ID (e.g. MAL-2026-3849, GHSA-...)
    Explain {
        id: String,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match cli.command {
        Cmd::Audit {
            path,
            json,
            offline,
            only_malicious,
            suspicious_publishing,
            window_minutes,
            burst_threshold,
            script_drift,
        } => audit(
            &path,
            json,
            offline,
            only_malicious,
            suspicious_publishing,
            window_minutes,
            burst_threshold,
            script_drift,
        ),
        Cmd::Diff {
            git_ref,
            path,
            json,
            offline,
            only_malicious,
            suspicious_publishing,
            window_minutes,
            burst_threshold,
            script_drift,
        } => diff_cmd(
            &path,
            &git_ref,
            json,
            offline,
            only_malicious,
            suspicious_publishing,
            window_minutes,
            burst_threshold,
            script_drift,
        ),
        Cmd::Explain { id } => explain(&id).map(|()| false),
    };
    match result {
        Ok(false) => ExitCode::SUCCESS,
        Ok(true) => ExitCode::from(2),
        Err(e) => {
            eprintln!("error: {e:#}");
            ExitCode::from(1)
        }
    }
}

// ---- shared OSV enrichment ---------------------------------------------------

// Unions every project's deps, queries OSV once, then attaches matched
// vulnerabilities back to each project. Returns the total unique-dep count.
fn enrich_with_osv(
    projects: &mut [ProjectResult],
    offline: bool,
    only_malicious: bool,
    allow: &allowlist::Allowlist,
) -> Result<usize> {
    let mut unique: BTreeSet<(String, String)> = BTreeSet::new();
    for p in projects.iter() {
        for d in &p.deps {
            unique.insert(d.clone());
        }
    }
    let total_unique = unique.len();
    let union_deps: Vec<(String, String)> = unique.into_iter().collect();

    let vulns = if offline || union_deps.is_empty() {
        Vec::new()
    } else {
        osv::query_batch(&union_deps, only_malicious)?
    };

    let mut vuln_map: BTreeMap<(String, String), Vec<osv::Vuln>> = BTreeMap::new();
    for v in &vulns {
        vuln_map
            .entry((v.package.clone(), v.version.clone()))
            .or_default()
            .push(v.clone());
    }

    let mut suppressed = 0usize;
    for p in projects.iter_mut() {
        let mut hits = Vec::new();
        for d in &p.deps {
            if let Some(vs) = vuln_map.get(d) {
                for v in vs {
                    if allow.allows_id(&v.id) || allow.allows_pkg(&v.package, &v.version) {
                        suppressed += 1;
                    } else {
                        hits.push(v.clone());
                    }
                }
            }
        }
        p.vulns = hits;
    }
    if suppressed > 0 {
        eprintln!("[allowlist] suppressed {suppressed} OSV finding(s) via .nsaignore");
    }

    Ok(total_unique)
}

fn filter_anomaly(a: &mut heuristic::AnomalyResult, allow: &allowlist::Allowlist) {
    if allow.is_empty() {
        return;
    }
    let before = a.hits.len();
    a.hits.retain(|(pkg, ver), _| !allow.allows_pkg(pkg, ver));
    let removed = before - a.hits.len();
    if removed > 0 {
        eprintln!("[allowlist] suppressed {removed} burst finding(s) via .nsaignore");
    }
}

fn filter_drift(d: &mut scriptdrift::DriftResult, allow: &allowlist::Allowlist) {
    if allow.is_empty() {
        return;
    }
    let before = d.hits.len();
    d.hits.retain(|h| !allow.allows_pkg(&h.package, &h.version));
    let removed = before - d.hits.len();
    if removed > 0 {
        eprintln!("[allowlist] suppressed {removed} script-drift finding(s) via .nsaignore");
    }
}

// ---- audit -------------------------------------------------------------------

fn audit(
    root: &Path,
    json: bool,
    offline: bool,
    only_malicious: bool,
    suspicious_publishing: bool,
    window_minutes: i64,
    burst_threshold: usize,
    script_drift: bool,
) -> Result<bool> {
    let allow = allowlist::Allowlist::load(root)?;
    let lockfiles = lockfile::find(root)?;

    let mut projects: Vec<ProjectResult> = lockfiles
        .into_iter()
        .map(|lf| {
            let (deps, parse_error) = match lockfile::parse(&lf) {
                Ok(mut d) => {
                    d.sort();
                    d.dedup();
                    (d, None)
                }
                Err(e) => (Vec::new(), Some(format!("{e:#}"))),
            };
            ProjectResult {
                lockfile: lf,
                deps,
                parse_error,
                vulns: Vec::new(),
            }
        })
        .collect();

    let total_unique = enrich_with_osv(&mut projects, offline, only_malicious, &allow)?;

    let anomaly = if suspicious_publishing {
        let union = union_deps(&projects);
        eprintln!("[heuristic] querying npm registry for {} package(s)...", union.len());
        let mut a = heuristic::detect(&union, window_minutes, burst_threshold)?;
        filter_anomaly(&mut a, &allow);
        Some(a)
    } else {
        None
    };

    let drift = if script_drift {
        let union = union_deps(&projects);
        eprintln!("[script-drift] checking install hooks for {} package(s)...", union.len());
        let mut d = scriptdrift::detect(&union)?;
        filter_drift(&mut d, &allow);
        Some(d)
    } else {
        None
    };

    let iocs = forensics::scan_ioc_files(root)?;
    let hooks = forensics::scan_claude_hooks()?;
    let exfil = forensics::scan_exfil_indicators(root)?;

    let has_issues = projects.iter().any(|p| !p.vulns.is_empty())
        || !iocs.is_empty()
        || !hooks.is_empty()
        || !exfil.is_empty()
        || anomaly.as_ref().map(|a| !a.hits.is_empty()).unwrap_or(false)
        || drift.as_ref().map(|d| !d.hits.is_empty()).unwrap_or(false);

    if json {
        let projects_json: Vec<_> = projects
            .iter()
            .map(|p| {
                serde_json::json!({
                    "lockfile": p.lockfile,
                    "dep_count": p.deps.len(),
                    "parse_error": p.parse_error,
                    "vulnerabilities": p.vulns,
                })
            })
            .collect();
        let out = serde_json::json!({
            "projects": projects_json,
            "total_unique_deps": total_unique,
            "ioc_files": iocs,
            "suspicious_hooks": hooks,
            "exfil_indicators": exfil.iter().map(|(p, i)| serde_json::json!({
                "file": p,
                "indicator": i,
            })).collect::<Vec<_>>(),
            "suspicious_publishing": anomaly.as_ref().map(anomaly_to_json),
            "script_drift": drift.as_ref().map(drift_to_json),
            "has_issues": has_issues,
            "offline": offline,
        });
        println!("{}", serde_json::to_string_pretty(&out)?);
    } else {
        audit_report(&projects, total_unique, &iocs, &hooks, &exfil, offline);
        if let Some(a) = &anomaly {
            print_anomaly(a);
        }
        if let Some(d) = &drift {
            print_drift(d);
        }
    }

    Ok(has_issues)
}

fn union_deps(projects: &[ProjectResult]) -> Vec<(String, String)> {
    let mut s: BTreeSet<(String, String)> = BTreeSet::new();
    for p in projects {
        for d in &p.deps {
            s.insert(d.clone());
        }
    }
    s.into_iter().collect()
}

fn print_anomaly(result: &heuristic::AnomalyResult) {
    println!();
    println!("== Suspicious publishing patterns ==");
    println!();
    println!(
        "Queried npm registry for {} package(s){}",
        result.packages_queried,
        if result.fetch_failures > 0 {
            format!(" ({} fetch failures)", result.fetch_failures)
        } else {
            String::new()
        }
    );
    println!();
    if result.hits.is_empty() {
        println!("[OK]    No burst-publishing anomalies detected");
        return;
    }
    println!(
        "[ALERT] {} (package, version) pair(s) fell into suspicious burst windows:",
        result.hits.len()
    );
    for ((pkg, ver), windows) in &result.hits {
        for w in windows {
            println!("        - {pkg}@{ver}");
            println!(
                "          maintainer '{}' published {} distinct packages between {} and {}",
                w.maintainer,
                w.package_count,
                w.window_start.format("%Y-%m-%d %H:%M:%S UTC"),
                w.window_end.format("%H:%M:%S UTC")
            );
        }
    }
}

fn anomaly_to_json(result: &heuristic::AnomalyResult) -> serde_json::Value {
    let hits: Vec<_> = result
        .hits
        .iter()
        .map(|((pkg, ver), windows)| {
            serde_json::json!({
                "package": pkg,
                "version": ver,
                "windows": windows.iter().map(|w| serde_json::json!({
                    "maintainer": w.maintainer,
                    "package_count": w.package_count,
                    "window_start": w.window_start.to_rfc3339(),
                    "window_end": w.window_end.to_rfc3339(),
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    serde_json::json!({
        "packages_queried": result.packages_queried,
        "fetch_failures": result.fetch_failures,
        "hits": hits,
    })
}

fn print_drift(result: &scriptdrift::DriftResult) {
    println!();
    println!("== Install-script drift ==");
    println!();
    println!(
        "Checked install hooks across {} package(s){}",
        result.packages_queried,
        if result.fetch_failures > 0 {
            format!(" ({} fetch failures)", result.fetch_failures)
        } else {
            String::new()
        }
    );
    println!();
    if result.hits.is_empty() {
        println!("[OK]    No newly-introduced install hooks");
        return;
    }
    println!(
        "[ALERT] {} package(s) introduced an install hook vs the prior version:",
        result.hits.len()
    );
    for h in &result.hits {
        println!("        - {}@{}  (prev: {})", h.package, h.version, h.prev_version);
        for (hook, body) in &h.introduced {
            println!("          + {hook}: {body}");
        }
        if h.cur_size > 0 && h.prev_size > 0 && h.cur_size >= h.prev_size * 2 {
            println!(
                "          ! unpacked size {} -> {} bytes ({}x)",
                h.prev_size,
                h.cur_size,
                h.cur_size / h.prev_size.max(1)
            );
        }
    }
}

fn drift_to_json(result: &scriptdrift::DriftResult) -> serde_json::Value {
    let hits: Vec<_> = result
        .hits
        .iter()
        .map(|h| {
            serde_json::json!({
                "package": h.package,
                "version": h.version,
                "prev_version": h.prev_version,
                "introduced": h.introduced.iter().map(|(hook, body)| serde_json::json!({
                    "hook": hook,
                    "script": body,
                })).collect::<Vec<_>>(),
                "prev_unpacked_size": h.prev_size,
                "cur_unpacked_size": h.cur_size,
            })
        })
        .collect();
    serde_json::json!({
        "packages_queried": result.packages_queried,
        "fetch_failures": result.fetch_failures,
        "hits": hits,
    })
}

fn audit_report(
    projects: &[ProjectResult],
    total_unique: usize,
    iocs: &[PathBuf],
    hooks: &[String],
    exfil: &[(PathBuf, String)],
    offline: bool,
) {
    println!("== npm-supply-audit report ==");
    println!();
    println!(
        "{} lockfile(s) scanned, {} unique deps across all projects",
        projects.len(),
        total_unique
    );
    println!();

    let with_issues: Vec<&ProjectResult> =
        projects.iter().filter(|p| !p.vulns.is_empty()).collect();
    let errored: Vec<&ProjectResult> =
        projects.iter().filter(|p| p.parse_error.is_some()).collect();
    let clean: Vec<&ProjectResult> = projects
        .iter()
        .filter(|p| p.vulns.is_empty() && p.parse_error.is_none())
        .collect();

    if offline {
        println!("[SKIP] OSV query skipped (--offline)");
        println!();
    } else if with_issues.is_empty() {
        println!("[OK]    No OSV hits in any project");
        println!();
    } else {
        println!("Projects with issues ({}):", with_issues.len());
        println!();
        for p in &with_issues {
            println!(
                "[ALERT] {}  ({} deps, {} hit(s))",
                p.lockfile.display(),
                p.deps.len(),
                p.vulns.len()
            );
            for v in &p.vulns {
                println!(
                    "        - {}@{}  {}  {}",
                    v.package, v.version, v.id, v.summary
                );
            }
            println!();
        }
    }

    if !errored.is_empty() {
        println!("Parse warnings ({}):", errored.len());
        for p in &errored {
            if let Some(e) = &p.parse_error {
                println!("  ! {}: {e}", p.lockfile.display());
            }
        }
        println!();
    }

    if !clean.is_empty() {
        println!("Clean projects ({}):", clean.len());
        for p in &clean {
            println!("  - {} ({} deps)", p.lockfile.display(), p.deps.len());
        }
        println!();
    }

    if iocs.is_empty() {
        println!("[OK]    No known IOC files under scan path");
    } else {
        println!("[ALERT] {} IOC file(s) found:", iocs.len());
        for p in iocs {
            println!("        - {}", p.display());
        }
    }
    println!();
    if hooks.is_empty() {
        println!("[OK]    Claude Code hooks configuration looks clean");
    } else {
        println!("[ALERT] Suspicious entries in Claude Code config:");
        for h in hooks {
            println!("        - {h}");
        }
    }
    println!();
    if exfil.is_empty() {
        println!("[OK]    No known exfil endpoints in repo files");
    } else {
        println!("[ALERT] {} file(s) reference a known exfil endpoint:", exfil.len());
        for (path, ind) in exfil {
            println!("        - {}  ({ind})", path.display());
        }
    }
}

// ---- diff --------------------------------------------------------------------

fn diff_cmd(
    root: &Path,
    git_ref: &str,
    json: bool,
    offline: bool,
    only_malicious: bool,
    suspicious_publishing: bool,
    window_minutes: i64,
    burst_threshold: usize,
    script_drift: bool,
) -> Result<bool> {
    let allow = allowlist::Allowlist::load(root)?;
    let changes = diff::collect_changes(root, git_ref)?;

    if changes.is_empty() {
        if json {
            let out = serde_json::json!({
                "git_ref": git_ref,
                "lockfile_changes": [],
                "has_issues": false,
            });
            println!("{}", serde_json::to_string_pretty(&out)?);
        } else {
            println!("== nsa diff {git_ref}..HEAD ==");
            println!();
            println!("No lockfile changes.");
        }
        return Ok(false);
    }

    let mut projects: Vec<ProjectResult> = changes
        .into_iter()
        .map(|c| ProjectResult {
            lockfile: c.lockfile,
            deps: c.introduced,
            parse_error: None,
            vulns: Vec::new(),
        })
        .collect();

    let total_introduced = enrich_with_osv(&mut projects, offline, only_malicious, &allow)?;

    let anomaly = if suspicious_publishing {
        let union = union_deps(&projects);
        eprintln!("[heuristic] querying npm registry for {} introduced package(s)...", union.len());
        let mut a = heuristic::detect(&union, window_minutes, burst_threshold)?;
        filter_anomaly(&mut a, &allow);
        Some(a)
    } else {
        None
    };

    let drift = if script_drift {
        let union = union_deps(&projects);
        eprintln!("[script-drift] checking install hooks for {} introduced package(s)...", union.len());
        let mut d = scriptdrift::detect(&union)?;
        filter_drift(&mut d, &allow);
        Some(d)
    } else {
        None
    };

    let has_issues = projects.iter().any(|p| !p.vulns.is_empty())
        || anomaly.as_ref().map(|a| !a.hits.is_empty()).unwrap_or(false)
        || drift.as_ref().map(|d| !d.hits.is_empty()).unwrap_or(false);

    if json {
        let projects_json: Vec<_> = projects
            .iter()
            .map(|p| {
                serde_json::json!({
                    "lockfile": p.lockfile,
                    "introduced": p.deps,
                    "vulnerabilities": p.vulns,
                })
            })
            .collect();
        let out = serde_json::json!({
            "git_ref": git_ref,
            "lockfile_changes": projects_json,
            "total_introduced": total_introduced,
            "suspicious_publishing": anomaly.as_ref().map(anomaly_to_json),
            "script_drift": drift.as_ref().map(drift_to_json),
            "has_issues": has_issues,
            "offline": offline,
        });
        println!("{}", serde_json::to_string_pretty(&out)?);
    } else {
        diff_report(&projects, git_ref, total_introduced, offline);
        if let Some(a) = &anomaly {
            print_anomaly(a);
        }
        if let Some(d) = &drift {
            print_drift(d);
        }
    }

    Ok(has_issues)
}

fn diff_report(projects: &[ProjectResult], git_ref: &str, total_introduced: usize, offline: bool) {
    println!("== nsa diff {git_ref}..HEAD ==");
    println!();
    println!(
        "{} lockfile(s) changed, {} new (package, version) pair(s)",
        projects.len(),
        total_introduced
    );
    println!();

    if offline {
        println!("[SKIP] OSV query skipped (--offline)");
        println!();
        for p in projects {
            println!(
                "  - {}  ({} introduced)",
                p.lockfile.display(),
                p.deps.len()
            );
        }
        return;
    }

    let with_issues: Vec<&ProjectResult> =
        projects.iter().filter(|p| !p.vulns.is_empty()).collect();

    if with_issues.is_empty() {
        println!("[OK] No OSV hits among introduced deps");
        println!();
        for p in projects {
            println!(
                "  - {}  ({} introduced)",
                p.lockfile.display(),
                p.deps.len()
            );
        }
    } else {
        for p in projects {
            if p.vulns.is_empty() {
                println!(
                    "[OK]    {}  ({} introduced, no hits)",
                    p.lockfile.display(),
                    p.deps.len()
                );
            } else {
                println!(
                    "[ALERT] {}  ({} introduced, {} hit(s))",
                    p.lockfile.display(),
                    p.deps.len(),
                    p.vulns.len()
                );
                for v in &p.vulns {
                    println!(
                        "        - {}@{}  {}  {}",
                        v.package, v.version, v.id, v.summary
                    );
                }
            }
        }
    }
}

// ---- explain -----------------------------------------------------------------

fn explain(id: &str) -> Result<()> {
    let adv = osv::fetch_advisory(id)?;
    println!("== {id} ==");
    println!();
    if !adv.summary.is_empty() {
        println!("Summary:   {}", adv.summary);
    }
    if !adv.published.is_empty() {
        println!("Published: {}", adv.published);
    }
    if !adv.modified.is_empty() {
        println!("Modified:  {}", adv.modified);
    }
    println!();

    if adv.affected.is_empty() {
        println!("Affected packages: (none listed)");
    } else {
        println!("Affected packages:");
        for entry in &adv.affected {
            let eco = if entry.package.ecosystem.is_empty() {
                "?"
            } else {
                entry.package.ecosystem.as_str()
            };
            println!("  - {} ({})", entry.package.name, eco);
            if entry.versions.is_empty() {
                println!("      versions: <ranges-only, no explicit list>");
            } else {
                println!("      versions: {}", entry.versions.join(", "));
            }
        }
    }
    println!();

    if !adv.references.is_empty() {
        println!("References:");
        for r in &adv.references {
            let t = if r.kind.is_empty() { "WEB" } else { r.kind.as_str() };
            println!("  [{t}] {}", r.url);
        }
        println!();
    }

    if !adv.details.is_empty() {
        println!("Details:");
        println!("{}", adv.details);
    }
    Ok(())
}
