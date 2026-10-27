use crate::types::{PhiResult, Predicate};
use globset::{GlobBuilder, GlobSetBuilder};

/// Whether Φ holds for a recorded result (`spec/predicate-v0.md`). Ignores `r.holds`: this is the recomputation.
/// An `allowed_paths` glob that does not parse makes Φ not hold.
pub fn phi_holds(phi: &Predicate, r: &PhiResult) -> bool {
    if r.exit_code != phi.expected_exit {
        return false;
    }
    if let Some(globs) = &phi.allowed_paths {
        let mut set = GlobSetBuilder::new();
        for g in globs {
            match GlobBuilder::new(g).literal_separator(true).build() {
                Ok(glob) => {
                    set.add(glob);
                }
                Err(_) => return false,
            }
        }
        let Ok(set) = set.build() else { return false };
        if !r.changed_paths.iter().all(|p| set.is_match(p)) {
            return false;
        }
    }
    if let Some(expected) = &phi.artifact_hashes
        && !expected
            .iter()
            .all(|(path, h)| r.observed_artifact_hashes.get(path) == Some(h))
    {
        return false;
    }
    true
}
