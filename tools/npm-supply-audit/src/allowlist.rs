// Per-project allowlist for vetted / known-false-positive findings.
//
// Reads `.nsaignore` from the scan root. Each non-empty, non-`#` line is one of:
//   - a bare package name        → `fs`            (suppress all findings for it)
//   - a package@version pair      → `fs@0.0.1-security`
//   - an advisory ID              → `MAL-2026-3849`, `GHSA-...`, `CVE-...`
// Scoped names work too (`@scope/name`, `@scope/name@1.2.3`) — we split the
// version on the LAST `@`, so the leading scope `@` is never mistaken for one.

use anyhow::{Context, Result};
use std::collections::BTreeSet;
use std::path::Path;

#[derive(Default)]
pub struct Allowlist {
    names: BTreeSet<String>,
    pairs: BTreeSet<(String, String)>,
    ids: BTreeSet<String>,
}

impl Allowlist {
    pub fn load(root: &Path) -> Result<Allowlist> {
        let path = root.join(".nsaignore");
        if !path.exists() {
            return Ok(Allowlist::default());
        }
        let body =
            std::fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
        Ok(Allowlist::parse(&body))
    }

    pub fn parse(body: &str) -> Allowlist {
        let mut al = Allowlist::default();
        for raw in body.lines() {
            let line = raw.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            let upper = line.to_ascii_uppercase();
            if upper.starts_with("MAL-") || upper.starts_with("GHSA-") || upper.starts_with("CVE-")
            {
                al.ids.insert(line.to_string());
                continue;
            }
            // Split on the LAST '@': for `@scope/name@1.2.3` that's the version
            // separator; for a bare `@scope/name` the only '@' is at index 0.
            if let Some(idx) = line.rfind('@') {
                if idx > 0 {
                    let (name, ver) = line.split_at(idx);
                    al.pairs.insert((name.to_string(), ver[1..].to_string()));
                    continue;
                }
            }
            al.names.insert(line.to_string());
        }
        al
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty() && self.pairs.is_empty() && self.ids.is_empty()
    }

    pub fn allows_pkg(&self, name: &str, version: &str) -> bool {
        self.names.contains(name)
            || self
                .pairs
                .contains(&(name.to_string(), version.to_string()))
    }

    pub fn allows_id(&self, id: &str) -> bool {
        self.ids.contains(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_each_entry_kind() {
        let al = Allowlist::parse(
            "\
# vetted false positives
fs@0.0.1-security
lodash            # whole package
@antv/adjust@0.3.5
@types/node
MAL-2026-3849
GHSA-qcp2-qp9h-qprg
",
        );
        assert!(al.allows_pkg("fs", "0.0.1-security"));
        assert!(!al.allows_pkg("fs", "1.0.0"), "version-pinned, other versions stay");
        assert!(al.allows_pkg("lodash", "4.17.21"), "bare name suppresses any version");
        assert!(al.allows_pkg("@antv/adjust", "0.3.5"));
        assert!(!al.allows_pkg("@antv/adjust", "0.4.5"));
        assert!(al.allows_pkg("@types/node", "20.0.0"), "scoped bare name");
        assert!(al.allows_id("MAL-2026-3849"));
        assert!(al.allows_id("GHSA-qcp2-qp9h-qprg"));
        assert!(!al.allows_id("MAL-2026-0000"));
    }

    #[test]
    fn empty_when_no_entries() {
        assert!(Allowlist::parse("# just a comment\n\n   \n").is_empty());
    }
}
