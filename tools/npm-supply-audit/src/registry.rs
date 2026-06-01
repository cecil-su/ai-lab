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
    #[serde(default)]
    pub scripts: BTreeMap<String, String>,
    #[serde(default)]
    pub dist: Dist,
}

#[derive(Deserialize, Default)]
pub struct Dist {
    #[serde(rename = "unpackedSize", default)]
    pub unpacked_size: u64,
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

// Fetch many packuments concurrently with a fixed worker pool. Failed fetches
// come back as `None` so the caller decides how to count them.
pub fn fetch_packuments_parallel(
    client: &reqwest::blocking::Client,
    packages: &[String],
    concurrency: usize,
) -> Vec<(String, Option<Packument>)> {
    if packages.is_empty() {
        return Vec::new();
    }
    let workers = concurrency.max(1);
    let chunk_size = packages.len().div_ceil(workers).max(1);

    std::thread::scope(|s| {
        let handles: Vec<_> = packages
            .chunks(chunk_size)
            .map(|chunk| {
                s.spawn(move || {
                    chunk
                        .iter()
                        .map(|pkg| (pkg.clone(), fetch_packument(client, pkg).ok()))
                        .collect::<Vec<_>>()
                })
            })
            .collect();

        let mut out = Vec::with_capacity(packages.len());
        for h in handles {
            out.extend(h.join().expect("packument worker panicked"));
        }
        out
    })
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
