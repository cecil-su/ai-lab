use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

const OSV_BATCH_URL: &str = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL: &str = "https://api.osv.dev/v1/vulns/";
const BATCH_SIZE: usize = 1000;

#[derive(Serialize)]
struct BatchReq {
    queries: Vec<Query>,
}

#[derive(Serialize)]
struct Query {
    package: PkgRef,
    version: String,
}

#[derive(Serialize)]
struct PkgRef {
    ecosystem: &'static str,
    name: String,
}

#[derive(Deserialize)]
struct BatchResp {
    #[serde(default)]
    results: Vec<QueryResult>,
}

#[derive(Deserialize, Default)]
struct QueryResult {
    #[serde(default)]
    vulns: Vec<VulnRef>,
}

#[derive(Deserialize)]
struct VulnRef {
    id: String,
}

#[derive(Deserialize, Default, Clone)]
pub struct Advisory {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub details: String,
    #[serde(default)]
    pub published: String,
    #[serde(default)]
    pub modified: String,
    #[serde(default)]
    pub affected: Vec<AffectedEntry>,
    #[serde(default)]
    pub references: Vec<Reference>,
}

#[derive(Deserialize, Default, Clone)]
pub struct AffectedEntry {
    #[serde(default)]
    pub package: AffectedPkg,
    #[serde(default)]
    pub versions: Vec<String>,
}

#[derive(Deserialize, Default, Clone)]
pub struct AffectedPkg {
    #[serde(default)]
    pub ecosystem: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Deserialize, Default, Clone)]
pub struct Reference {
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct Vuln {
    pub package: String,
    pub version: String,
    pub id: String,
    pub summary: String,
}

fn make_client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("npm-supply-audit/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(60))
        .build()
        .context("build http client")
}

pub fn fetch_advisory(id: &str) -> Result<Advisory> {
    let client = make_client()?;
    fetch_detail(&client, id)
}

pub fn query_batch(deps: &[(String, String)], only_malicious: bool) -> Result<Vec<Vuln>> {
    if deps.is_empty() {
        return Ok(Vec::new());
    }
    let client = make_client()?;

    let mut findings = Vec::new();
    let mut detail_cache: HashMap<String, Advisory> = HashMap::new();

    for chunk in deps.chunks(BATCH_SIZE) {
        let req = BatchReq {
            queries: chunk
                .iter()
                .map(|(n, v)| Query {
                    package: PkgRef {
                        ecosystem: "npm",
                        name: n.clone(),
                    },
                    version: v.clone(),
                })
                .collect(),
        };

        let resp = client
            .post(OSV_BATCH_URL)
            .json(&req)
            .send()
            .context("OSV batch request")?
            .error_for_status()
            .context("OSV batch response")?
            .json::<BatchResp>()
            .context("OSV batch decode")?;

        for (i, result) in resp.results.iter().enumerate() {
            let (name, version) = &chunk[i];
            for v in &result.vulns {
                if only_malicious && !v.id.starts_with("MAL-") {
                    continue;
                }
                let detail = detail_cache
                    .entry(v.id.clone())
                    .or_insert_with(|| fetch_detail(&client, &v.id).unwrap_or_default());

                // OSV querybatch returns MAL-* advisories without filtering by version.
                // Re-confirm locally against affected.versions before reporting.
                if !affects(detail, name, version) {
                    continue;
                }

                findings.push(Vuln {
                    package: name.clone(),
                    version: version.clone(),
                    id: v.id.clone(),
                    summary: detail.summary.clone(),
                });
            }
        }
    }
    Ok(findings)
}

fn fetch_detail(client: &reqwest::blocking::Client, id: &str) -> Result<Advisory> {
    let url = format!("{OSV_VULN_URL}{id}");
    let detail: Advisory = client
        .get(&url)
        .send()?
        .error_for_status()?
        .json()
        .context("OSV vuln decode")?;
    Ok(detail)
}

// True iff the advisory lists this (name, version) under affected[].versions.
// If the advisory has no explicit `versions` for this package (ranges-only),
// fall back to true so we don't silently drop a real hit.
fn affects(detail: &Advisory, name: &str, version: &str) -> bool {
    let mut saw_pkg = false;
    let mut has_versions = false;
    for entry in &detail.affected {
        if entry.package.ecosystem != "npm" || entry.package.name != name {
            continue;
        }
        saw_pkg = true;
        if !entry.versions.is_empty() {
            has_versions = true;
            if entry.versions.iter().any(|v| v == version) {
                return true;
            }
        }
    }
    if !saw_pkg {
        return false;
    }
    !has_versions
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detail(name: &str, versions: &[&str]) -> Advisory {
        Advisory {
            summary: "x".into(),
            affected: vec![AffectedEntry {
                package: AffectedPkg {
                    ecosystem: "npm".into(),
                    name: name.into(),
                },
                versions: versions.iter().map(|s| (*s).into()).collect(),
            }],
            ..Default::default()
        }
    }

    #[test]
    fn affects_exact_match() {
        let d = detail("@antv/adjust", &["0.3.5", "0.4.5"]);
        assert!(affects(&d, "@antv/adjust", "0.3.5"));
        assert!(affects(&d, "@antv/adjust", "0.4.5"));
    }

    #[test]
    fn affects_rejects_unmatched_version() {
        let d = detail("@antv/adjust", &["0.3.5", "0.4.5"]);
        assert!(!affects(&d, "@antv/adjust", "0.1.1"));
        assert!(!affects(&d, "@antv/adjust", "0.2.5"));
    }

    #[test]
    fn affects_rejects_unrelated_package() {
        let d = detail("@antv/adjust", &["0.3.5"]);
        assert!(!affects(&d, "lodash", "0.3.5"));
    }

    #[test]
    fn affects_conservative_when_ranges_only() {
        let d = Advisory {
            summary: "x".into(),
            affected: vec![AffectedEntry {
                package: AffectedPkg {
                    ecosystem: "npm".into(),
                    name: "foo".into(),
                },
                versions: Vec::new(),
            }],
            ..Default::default()
        };
        assert!(affects(&d, "foo", "1.2.3"));
    }
}
