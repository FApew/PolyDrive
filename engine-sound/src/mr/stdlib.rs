//! The engine-sim standard library, embedded.
//!
//! A `.mr` engine file is only the top of an iceberg: it says
//! `import "engine_sim.mr"` and then relies on several thousand lines of node
//! definitions for units, constants, the object model, the actions and the part
//! library. Those are shipped here verbatim (MIT, same as the rest of the port)
//! and interpreted, rather than reimplemented — so `add_flow_sample` converts
//! thou and flow-bench figures exactly as the original does, and a part from
//! the library behaves the way its author intended.
//!
//! Only the `__engine_sim__*` nodes the library binds with `=>` are native; see
//! [`super::builtins`].

/// Definitions this port adds on top of the vendored library, loaded after it
/// so a real definition always wins. See `mr-stdlib/compat.mr`.
pub const COMPAT: (&str, &str) = ("compat.mr", include_str!("../../mr-stdlib/compat.mr"));

/// `(path, source)` for every file in the embedded library.
pub const FILES: &[(&str, &str)] = &[
    COMPAT,
    (
        "engine_sim.mr",
        include_str!("../../mr-stdlib/engine_sim.mr"),
    ),
    (
        "actions/actions.mr",
        include_str!("../../mr-stdlib/actions/actions.mr"),
    ),
    (
        "constants/constants.mr",
        include_str!("../../mr-stdlib/constants/constants.mr"),
    ),
    (
        "constants/units.mr",
        include_str!("../../mr-stdlib/constants/units.mr"),
    ),
    (
        "infrastructure/infrastructure.mr",
        include_str!("../../mr-stdlib/infrastructure/infrastructure.mr"),
    ),
    (
        "objects/objects.mr",
        include_str!("../../mr-stdlib/objects/objects.mr"),
    ),
    (
        "part-library/part_library.mr",
        include_str!("../../mr-stdlib/part-library/part_library.mr"),
    ),
    (
        "part-library/parts/cam_lobes.mr",
        include_str!("../../mr-stdlib/part-library/parts/cam_lobes.mr"),
    ),
    (
        "part-library/parts/camshafts.mr",
        include_str!("../../mr-stdlib/part-library/parts/camshafts.mr"),
    ),
    (
        "part-library/parts/heads.mr",
        include_str!("../../mr-stdlib/part-library/parts/heads.mr"),
    ),
    (
        "part-library/parts/ignition_modules.mr",
        include_str!("../../mr-stdlib/part-library/parts/ignition_modules.mr"),
    ),
    (
        "part-library/parts/intakes.mr",
        include_str!("../../mr-stdlib/part-library/parts/intakes.mr"),
    ),
    (
        "settings/application_settings.mr",
        include_str!("../../mr-stdlib/settings/application_settings.mr"),
    ),
    (
        "sound-library/impulse_responses.mr",
        include_str!("../../mr-stdlib/sound-library/impulse_responses.mr"),
    ),
    (
        "types/atomic_types.mr",
        include_str!("../../mr-stdlib/types/atomic_types.mr"),
    ),
    (
        "types/conversions.mr",
        include_str!("../../mr-stdlib/types/conversions.mr"),
    ),
    (
        "types/operations.mr",
        include_str!("../../mr-stdlib/types/operations.mr"),
    ),
    (
        "utilities/utilities.mr",
        include_str!("../../mr-stdlib/utilities/utilities.mr"),
    ),
];

/// Resolves an import path against the file that contains it.
///
/// Paths are relative and use `..`, e.g. `"../types/atomic_types.mr"` from
/// `constants/units.mr`. A bare name is also looked up at the library root so
/// that a user file's `import "engine_sim.mr"` works.
pub fn resolve(from: &str, path: &str) -> Option<&'static str> {
    let base_dir = from.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");

    let mut parts: Vec<&str> = if base_dir.is_empty() {
        Vec::new()
    } else {
        base_dir.split('/').collect()
    };

    for segment in path.split('/') {
        match segment {
            "." | "" => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    let joined = parts.join("/");

    lookup(&joined).or_else(|| {
        // Fall back to the bare file name anywhere in the library.
        let name = path.rsplit('/').next()?;
        FILES
            .iter()
            .find(|(p, _)| *p == name || p.ends_with(&format!("/{name}")))
            .map(|(_, src)| *src)
    })
}

fn lookup(path: &str) -> Option<&'static str> {
    FILES.iter().find(|(p, _)| *p == path).map(|(_, src)| *src)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_imports() {
        assert!(resolve("constants/units.mr", "constants.mr").is_some());
        assert!(resolve("constants/units.mr", "../types/atomic_types.mr").is_some());
        assert!(resolve("engine_sim.mr", "objects/objects.mr").is_some());
        // A user file living outside the library still finds the entry point.
        assert!(resolve("user.mr", "engine_sim.mr").is_some());
        assert!(resolve("user.mr", "nonsense.mr").is_none());
    }

    #[test]
    fn every_embedded_file_parses() {
        for (path, source) in FILES {
            super::super::parser::parse(source).unwrap_or_else(|e| panic!("{path}: {e}"));
        }
    }
}
