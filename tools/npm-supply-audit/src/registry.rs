use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::time::Duration;

#[derive(Deserialize)]
pub struct Packument {
    #[serde(default)]
    pub time: BTreeMap<String, String>,
    #[serde(default)]
    pub maintainers: Vec<Maintainer>,
    #[serde(default)]
    pub versions: BTreeMap<String, VersionMeta>,
}

#[derive(Deserialize, Clone)]
pub struct Maintainer {
    pub name: String,
}

#[derive(Deserialize, Default)]
pub struct VersionMeta {
    #[serde(default)]
    pub maintainers: Vec<Maintainer>,
}

impl Packument {
    // Prefer per-version maintainers (frozen at publish time) over top-level
    // (current account state, may differ after account recovery).
    pub fn maintainers_of(&self, version: &str) -> Vec<&Maintainer> {
        if let Some(vm) = self.versions.get(version) {
            if !vm.maintainers.is_empty() {
                return vm.maintainers.iter().collect();
            }
        }
        self.maintainers.iter().collect()
    }
}

pub fn make_client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("npm-supply-audit/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .context("build http client")
}

pub fn fetch_packument(client: &reqwest::blocking::Client, name: &str) -> Result<Packument> {
    let encoded = name.replace('/', "%2F");
    let url = format!("https://registry.npmjs.org/{encoded}");
    let resp = client
        .get(&url)
        .send()
        .with_context(|| format!("fetch {name}"))?;
    let status = resp.status();
    if !status.is_success() {
        anyhow::bail!("registry {name}: HTTP {status}");
    }
    resp.json().context("decode packument")
}

#[derive(Deserialize)]
struct SearchResp {
    #[serde(default)]
    total: u64,
    #[serde(default)]
    objects: Vec<SearchObject>,
}

#[derive(Deserialize)]
struct SearchObject {
    package: SearchPackage,
}

#[derive(Deserialize)]
struct SearchPackage {
    name: String,
}

// Reverse-lookup: ask npm registry for every package this maintainer is listed on.
// Used to discover bulk-publishing bursts whose footprint is larger than the
// user's lockfile reveals (e.g. atool 5-19 published 314 packages; a user may
// only have 3 of them).
pub fn list_maintainer_packages(
    client: &reqwest::blocking::Client,
    maintainer: &str,
) -> Result<Vec<String>> {
    let mut out = Vec::new();
    let mut from = 0u64;
    let page_size = 250u64;
    loop {
        let url = format!(
            "https://registry.npmjs.org/-/v1/search?text=maintainer:{maintainer}&size={page_size}&from={from}"
        );
        let resp = client
            .get(&url)
            .send()
            .with_context(|| format!("search maintainer:{maintainer}"))?;
        if !resp.status().is_success() {
            anyhow::bail!("search maintainer:{maintainer}: HTTP {}", resp.status());
        }
        let body: SearchResp = resp.json().context("decode search response")?;
        let returned = body.objects.len() as u64;
        for o in body.objects {
            out.push(o.package.name);
        }
        from += returned;
        if returned == 0 || from >= body.total {
            break;
        }
        // Safety cap: don't follow more than ~2000 packages per maintainer
        if out.len() >= 2000 {
            break;
        }
    }
    Ok(out)
}
