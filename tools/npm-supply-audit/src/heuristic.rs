// Maintainer burst-publishing anomaly detector.
//
// Core idea: Shai-Hulud / Mini Shai-Hulud attacks have a stable fingerprint —
// once an attacker takes over a maintainer's npm account, they publish
// dozens-to-hundreds of distinct package versions in a tight time window
// (AntV 2026-05-19: 314 packages in 22 minutes). Legitimate maintainers
// almost never do this.
//
// Algorithm: for each (name, version) in the user's lockfile, fetch the npm
// packument and collect *every* publish event by every maintainer of that
// package. Group events by maintainer and slide a time window across each
// maintainer's timeline — if >= `threshold` distinct packages were published
// inside any `window_minutes` window, flag the user-facing versions that
// fell inside it.

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use std::collections::{BTreeMap, BTreeSet};

use crate::registry;

#[derive(Debug, Clone)]
pub struct SuspiciousWindow {
    pub maintainer: String,
    pub package_count: usize,
    pub window_start: DateTime<Utc>,
    pub window_end: DateTime<Utc>,
}

pub struct AnomalyResult {
    pub hits: BTreeMap<(String, String), Vec<SuspiciousWindow>>,
    pub packages_queried: usize,
    pub fetch_failures: usize,
}

pub fn detect(
    deps: &[(String, String)],
    window_minutes: i64,
    threshold: usize,
) -> Result<AnomalyResult> {
    let client = registry::make_client()?;
    let user_set: BTreeSet<(String, String)> = deps.iter().cloned().collect();

    let mut unique_pkgs: BTreeSet<String> = BTreeSet::new();
    for (name, _) in deps {
        unique_pkgs.insert(name.clone());
    }
    let pkg_list: Vec<String> = unique_pkgs.into_iter().collect();
    let mut packages_queried = pkg_list.len();
    let mut fetch_failures = 0usize;
    let mut already_seen: BTreeSet<String> = pkg_list.iter().cloned().collect();

    let mut events_by_maintainer: BTreeMap<String, Vec<(String, String, DateTime<Utc>)>> =
        BTreeMap::new();

    // Phase 1: pull packuments for every package in the user's lockfile.
    let fetched = registry::fetch_packuments_parallel(&client, &pkg_list, 8);
    ingest_fetched(&fetched, &mut events_by_maintainer, &mut fetch_failures);

    let window = Duration::minutes(window_minutes);
    let min_prefix_groups = 2; // monorepo / platform-binary noise suppression

    // Phase 2: for every maintainer whose lockfile footprint already spans
    // multiple prefix-groups (cross-scope), reverse-lookup their full package
    // list and ingest the extras. Single-scope maintainers (rollup, esbuild)
    // are skipped — their footprint is the whole project, not a burst signal.
    let candidates = partial_burst_maintainers(
        &events_by_maintainer,
        threshold,
        min_prefix_groups,
    );
    for maintainer in &candidates {
        let extras = match registry::list_maintainer_packages(&client, maintainer) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let new_pkgs: Vec<String> = extras
            .into_iter()
            .filter(|p| !already_seen.contains(p))
            .collect();
        if new_pkgs.is_empty() {
            continue;
        }
        eprintln!(
            "[heuristic] reverse-lookup '{}': pulling {} extra packument(s)",
            maintainer,
            new_pkgs.len()
        );
        already_seen.extend(new_pkgs.iter().cloned());
        packages_queried += new_pkgs.len();
        let extra_fetched = registry::fetch_packuments_parallel(&client, &new_pkgs, 8);
        ingest_fetched(&extra_fetched, &mut events_by_maintainer, &mut fetch_failures);
    }

    // Phase 3: run burst detection on the enriched event set.
    let mut hits: BTreeMap<(String, String), Vec<SuspiciousWindow>> = BTreeMap::new();

    for (maintainer, mut evs) in events_by_maintainer {
        evs.sort_by_key(|(_, _, t)| *t);
        let windows = find_burst_windows(&evs, window, threshold, min_prefix_groups);
        for sw in merge_windows(windows, window) {
            let triggered: Vec<_> = sw
                .raw_events
                .iter()
                .filter(|(p, v, _)| user_set.contains(&(p.clone(), v.clone())))
                .cloned()
                .collect();
            if triggered.is_empty() {
                continue;
            }
            let suspicious = SuspiciousWindow {
                maintainer: maintainer.clone(),
                package_count: sw.unique_pkg_count,
                window_start: sw.start,
                window_end: sw.end,
            };
            for (p, v, _) in &triggered {
                hits.entry((p.clone(), v.clone()))
                    .or_default()
                    .push(suspicious.clone());
            }
        }
    }

    Ok(AnomalyResult {
        hits,
        packages_queried,
        fetch_failures,
    })
}

fn ingest_fetched(
    fetched: &[(String, Option<registry::Packument>)],
    events_by_maintainer: &mut BTreeMap<String, Vec<(String, String, DateTime<Utc>)>>,
    fetch_failures: &mut usize,
) {
    for (pkg, packument_opt) in fetched {
        let Some(packument) = packument_opt else {
            *fetch_failures += 1;
            continue;
        };
        for (ver, ts_str) in &packument.time {
            if ver == "created" || ver == "modified" {
                continue;
            }
            let Ok(ts) = DateTime::parse_from_rfc3339(ts_str) else {
                continue;
            };
            let ts: DateTime<Utc> = ts.with_timezone(&Utc);
            for m in packument.maintainers_of(ver) {
                events_by_maintainer
                    .entry(m.name.clone())
                    .or_default()
                    .push((pkg.clone(), ver.clone(), ts));
            }
        }
    }
}

// Picks maintainers whose lockfile footprint already crosses prefix-groups
// (i.e. looks like a partial cross-scope burst) but hasn't met the threshold.
// These are worth reverse-looking-up; single-scope maintainers aren't.
fn partial_burst_maintainers(
    events_by_maintainer: &BTreeMap<String, Vec<(String, String, DateTime<Utc>)>>,
    threshold: usize,
    min_groups: usize,
) -> Vec<String> {
    let mut out = Vec::new();
    for (maintainer, evs) in events_by_maintainer {
        let unique_pkgs: BTreeSet<&str> = evs.iter().map(|(p, _, _)| p.as_str()).collect();
        let unique_groups: BTreeSet<&str> = unique_pkgs.iter().map(|p| prefix_group(p)).collect();
        if unique_pkgs.len() < threshold && unique_groups.len() >= min_groups {
            out.push(maintainer.clone());
        }
    }
    out
}

struct BurstWindow {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    unique_pkg_count: usize,
    raw_events: Vec<(String, String, DateTime<Utc>)>,
}

// Group key for a package — used to suppress monorepo / platform-binary noise.
// Scoped packages `@scope/name` share group `@scope`; unscoped packages are
// their own group. A real attack typically spans multiple groups (atool 5-19
// hit @antv/* + size-sensor + timeago.js); a rollup release only spans one.
// Maps both `@rollup/rollup-darwin-arm64` and unscoped `rollup` to the same
// group "rollup" — collapsing monorepos that publish a main package alongside
// scoped platform-specific siblings (rollup, esbuild, swc, ...).
fn prefix_group(pkg: &str) -> &str {
    if let Some(stripped) = pkg.strip_prefix('@') {
        if let Some(slash_idx) = stripped.find('/') {
            return &stripped[..slash_idx];
        }
    }
    pkg
}

// Slides a time window across a maintainer's sorted publish events.
// A window is flagged only when both:
//   - it contains >= `threshold` distinct packages, AND
//   - those packages span >= `min_groups` prefix-groups.
fn find_burst_windows(
    events: &[(String, String, DateTime<Utc>)],
    window: Duration,
    threshold: usize,
    min_groups: usize,
) -> Vec<BurstWindow> {
    let mut out = Vec::new();
    let n = events.len();
    if n == 0 {
        return out;
    }
    let mut left = 0usize;
    let mut right = 0usize;
    while right < n {
        while events[right].2 - events[left].2 > window {
            left += 1;
        }
        let slice = &events[left..=right];
        let unique: BTreeSet<&String> = slice.iter().map(|(p, _, _)| p).collect();
        let groups: BTreeSet<&str> = unique.iter().map(|p| prefix_group(p)).collect();
        if unique.len() >= threshold && groups.len() >= min_groups {
            out.push(BurstWindow {
                start: events[left].2,
                end: events[right].2,
                unique_pkg_count: unique.len(),
                raw_events: slice.to_vec(),
            });
            left = right + 1;
            right = left;
            continue;
        }
        right += 1;
    }
    out
}

// The greedy detector emits non-overlapping windows in time order, fragmenting
// one logical burst into ≥threshold chunks (atool's 314-package / 22-minute
// burst comes back as a 16-pkg sub-chunk + a 10-pkg sub-chunk, the latter
// collapsing to a single instant). Merge windows whose gap is within one window
// span so the report shows the full footprint instead of an undersized chunk.
fn merge_windows(windows: Vec<BurstWindow>, gap: Duration) -> Vec<BurstWindow> {
    let mut out: Vec<BurstWindow> = Vec::new();
    for w in windows {
        if let Some(last) = out.last_mut() {
            if w.start - last.end <= gap {
                last.end = w.end;
                last.raw_events.extend(w.raw_events);
                let unique: BTreeSet<&String> =
                    last.raw_events.iter().map(|(p, _, _)| p).collect();
                last.unique_pkg_count = unique.len();
                continue;
            }
        }
        out.push(w);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(min: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 5, 19, 1, 0, 0).unwrap() + Duration::minutes(min)
    }

    #[test]
    fn detects_burst_when_threshold_met() {
        // 10 distinct packages, all published within 5 minutes
        let mut events = Vec::new();
        for i in 0..10 {
            events.push((format!("pkg{i}"), "1.0.0".into(), at(i / 2)));
        }
        let windows = find_burst_windows(&events, Duration::minutes(30), 10, 1);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].unique_pkg_count, 10);
    }

    #[test]
    fn ignores_slow_releases() {
        // 10 packages spread over 5 hours — not a burst
        let mut events = Vec::new();
        for i in 0..10 {
            events.push((format!("pkg{i}"), "1.0.0".into(), at(i * 30)));
        }
        let windows = find_burst_windows(&events, Duration::minutes(30), 10, 1);
        assert!(windows.is_empty());
    }

    #[test]
    fn same_package_multiple_versions_does_not_inflate_count() {
        // 10 versions of the same package within 5 minutes — not 10 distinct packages
        let mut events = Vec::new();
        for i in 0..10 {
            events.push(("solo-pkg".into(), format!("1.0.{i}"), at(i / 2)));
        }
        let windows = find_burst_windows(&events, Duration::minutes(30), 10, 1);
        assert!(windows.is_empty(), "expected unique-package threshold");
    }

    #[test]
    fn just_below_threshold_does_not_fire() {
        let mut events = Vec::new();
        for i in 0..9 {
            events.push((format!("pkg{i}"), "1.0.0".into(), at(i)));
        }
        let windows = find_burst_windows(&events, Duration::minutes(30), 10, 1);
        assert!(windows.is_empty());
    }

    #[test]
    fn rejects_single_scope_burst_when_min_groups_2() {
        // 10 @rollup/* packages — looks like rollup platform-binary release, not attack
        let mut events = Vec::new();
        for i in 0..10 {
            events.push((format!("@rollup/pkg{i}"), "4.0.0".into(), at(i / 2)));
        }
        let windows = find_burst_windows(&events, Duration::minutes(30), 10, 2);
        assert!(windows.is_empty(), "single-scope burst should be filtered out");
    }

    #[test]
    fn accepts_cross_scope_burst() {
        // 10 packages spanning multiple scopes — atool-style attack signature
        let mut events = Vec::new();
        for i in 0..5 {
            events.push((format!("@antv/pkg{i}"), "0.3.5".into(), at(i)));
        }
        for i in 0..5 {
            events.push((format!("unscoped-{i}"), "1.0.4".into(), at(i + 5)));
        }
        let windows = find_burst_windows(&events, Duration::minutes(30), 10, 2);
        assert_eq!(windows.len(), 1);
    }

    #[test]
    fn merge_windows_combines_adjacent_burst_chunks() {
        // Simulate the greedy detector fragmenting one burst into two chunks:
        // chunk A at minutes 0-2, chunk B at minute 17 (gap < 30-min window).
        let mut a = Vec::new();
        for i in 0..10 {
            a.push((format!("a{i}"), "1.0.0".into(), at(i / 5)));
        }
        let mut b = Vec::new();
        for i in 0..6 {
            b.push((format!("b{i}"), "1.0.0".into(), at(17)));
        }
        let w1 = BurstWindow {
            start: at(0),
            end: at(2),
            unique_pkg_count: 10,
            raw_events: a,
        };
        let w2 = BurstWindow {
            start: at(17),
            end: at(17),
            unique_pkg_count: 6,
            raw_events: b,
        };
        let merged = merge_windows(vec![w1, w2], Duration::minutes(30));
        assert_eq!(merged.len(), 1, "adjacent chunks should merge");
        assert_eq!(merged[0].unique_pkg_count, 16, "footprint is the union");
        assert_eq!(merged[0].start, at(0));
        assert_eq!(merged[0].end, at(17));
    }

    #[test]
    fn merge_windows_keeps_distant_bursts_separate() {
        let w1 = BurstWindow {
            start: at(0),
            end: at(2),
            unique_pkg_count: 10,
            raw_events: vec![("a".into(), "1.0.0".into(), at(0))],
        };
        let w2 = BurstWindow {
            start: at(120),
            end: at(122),
            unique_pkg_count: 10,
            raw_events: vec![("b".into(), "1.0.0".into(), at(120))],
        };
        let merged = merge_windows(vec![w1, w2], Duration::minutes(30));
        assert_eq!(merged.len(), 2, "bursts >window apart stay separate");
    }

    #[test]
    fn prefix_group_classification() {
        assert_eq!(prefix_group("@rollup/rollup-darwin-arm64"), "rollup");
        assert_eq!(prefix_group("@antv/adjust"), "antv");
        assert_eq!(prefix_group("size-sensor"), "size-sensor");
        assert_eq!(prefix_group("timeago.js"), "timeago.js");
    }

    #[test]
    fn collapses_scoped_and_unscoped_same_project() {
        // rollup-style: main `rollup` + `@rollup/rollup-*` platform binaries
        let mut events = vec![("rollup".to_string(), "4.0.0".into(), at(0))];
        for i in 0..10 {
            events.push((format!("@rollup/rollup-platform-{i}"), "4.0.0".into(), at(i)));
        }
        let windows = find_burst_windows(&events, Duration::minutes(30), 10, 2);
        assert!(
            windows.is_empty(),
            "rollup main + scoped siblings should collapse to one group"
        );
    }
}
