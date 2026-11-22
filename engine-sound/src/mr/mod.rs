//! Reader for engine-sim's `.mr` engine description files.
//!
//! `.mr` is a small declarative language (Piranha). An engine file imports the
//! standard library, defines a few nodes of its own for its head and camshaft,
//! and ends with a `main` node that calls `set_engine`. Everything here exists
//! to run that and hand back an [`crate::config::EngineConfig`].
//!
//! ```
//! use engine_sound::mr;
//!
//! let source = r#"
//!     import "engine_sim.mr"
//!     units units()
//!     public node main {
//!         engine engine(name: "demo")
//!         crankshaft c0(throw: 40 * units.mm, moment_of_inertia: 0.2)
//!         rod_journal rj0(angle: 0 * units.deg)
//!         c0.add_rod_journal(rj0)
//!
//!         piston_parameters pp(mass: 300 * units.g, compression_height: 1 * units.inch)
//!         connecting_rod_parameters crp(mass: 300 * units.g, length: 140 * units.mm)
//!         intake intake(plenum_volume: 1 * units.L)
//!         exhaust_system exhaust(length: 2 * units.m, audio_volume: 0.2)
//!         cylinder_bank_parameters bp(bore: 86 * units.mm, deck_height: 220 * units.mm)
//!         cylinder_bank b0(bp, angle: 0)
//!         b0.add_cylinder(
//!             piston: piston(pp), connecting_rod: connecting_rod(crp),
//!             rod_journal: rj0, intake: intake, exhaust_system: exhaust)
//!         engine.add_cylinder_bank(b0)
//!         engine.add_crankshaft(c0)
//!         set_engine(engine)
//!     }
//! "#;
//!
//! let loaded = mr::load(source).unwrap();
//! assert_eq!(loaded.config.cylinders.len(), 1);
//! ```
//!
//! What is not supported: the vehicle, transmission and application settings
//! are parsed and discarded, since they do not affect the sound; impulse
//! responses name files from the original's asset tree, which is not shipped;
//! and this port has one cylinder head and one set of piston and rod dimensions
//! for the whole engine, so a file that varies those per bank loses the
//! difference. Every such case is reported in [`Loaded::warnings`].

pub mod ast;
pub mod builtins;
pub mod eval;
pub mod json;
pub mod lexer;
pub mod parser;
pub mod stdlib;
pub mod to_config;
pub mod value;

#[cfg(test)]
mod tests;

use crate::config::EngineConfig;
use std::collections::HashSet;
use std::fmt;

/// The result of reading a `.mr` file.
#[derive(Clone, Debug)]
pub struct Loaded {
    pub config: EngineConfig,
    /// Things the file asked for that this port could not honour exactly.
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub message: String,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for Error {}

/// Reads a `.mr` engine file.
///
/// The standard library is embedded, so the source only needs to be the engine
/// file itself — the same file the original loads.
pub fn load(source: &str) -> Result<Loaded, Error> {
    let mut interp = eval::Interpreter::new();

    // Load the standard library first, then the user's file, so a user node can
    // shadow a library one.
    let mut loaded = HashSet::new();
    let mut ordered = Vec::new();
    collect_imports("engine_sim.mr", "engine_sim.mr", &mut loaded, &mut ordered)?;
    // Loaded after the vendored library so its definitions can be overridden by
    // a file that brings its own.
    collect_imports(
        stdlib::COMPAT.0,
        stdlib::COMPAT.0,
        &mut loaded,
        &mut ordered,
    )?;

    let user = parser::parse(source).map_err(|e| Error {
        message: format!("syntax error: {e}"),
    })?;
    for path in &user.imports {
        collect_imports("user.mr", path, &mut loaded, &mut ordered)?;
    }

    for (path, file) in &ordered {
        interp.add_file(file);
        let _ = path;
    }
    interp.add_file(&user);

    for (path, file) in &ordered {
        interp.run_declarations(file).map_err(|e| Error {
            message: format!("{path}: {e}"),
        })?;
    }
    interp
        .run_declarations(&user)
        .map_err(|e| Error { message: e.message })?;

    let engine = find_engine(&interp, &user)?;

    let mut warnings = to_config::Warnings::default();
    let vehicle = interp.vehicle.borrow().clone();
    let transmission = interp.transmission.borrow().clone();
    let config = to_config::to_config(
        &engine,
        vehicle.as_ref(),
        transmission.as_ref(),
        &mut warnings,
    )
    .map_err(|e| Error { message: e.message })?;

    Ok(Loaded {
        config,
        warnings: warnings.0,
    })
}

/// Finds the engine the file describes.
///
/// The convention is a `main` node calling `set_engine`, but plenty of the
/// stock files are written as libraries that simply expose an engine from a
/// public node and expect the application to pick one. Both are accepted; for
/// the second the last public node that yields an engine wins, which is the one
/// a file of that shape puts at the bottom.
fn find_engine(interp: &eval::Interpreter, user: &ast::File) -> Result<value::ObjectRef, Error> {
    if user.nodes.iter().any(|n| n.name == "main") {
        interp
            .call_node("main")
            .map_err(|e| Error { message: e.message })?;
        return interp.engine.borrow().clone().ok_or_else(|| Error {
            message: "`main` never called `set_engine`".into(),
        });
    }

    let mut last_error = None;
    for def in user.nodes.iter().filter(|n| n.public).rev() {
        match interp.call_node(&def.name) {
            Ok(value) => {
                if let Some(engine) = interp.engine.borrow().clone() {
                    return Ok(engine);
                }
                if let Some(object) = value.as_object() {
                    if object.borrow().kind == "engine" {
                        return Ok(object);
                    }
                }
            }
            Err(e) => last_error = Some(e.message),
        }
    }

    Err(Error {
        message: match last_error {
            Some(e) => {
                format!("no `main` node, and no public node produced an engine (last error: {e})")
            }
            None => "no `main` node, and no public node produced an engine".into(),
        },
    })
}

fn collect_imports(
    from: &str,
    path: &str,
    loaded: &mut HashSet<String>,
    ordered: &mut Vec<(String, ast::File)>,
) -> Result<(), Error> {
    let Some(source) = stdlib::resolve(from, path) else {
        // A file importing something we do not ship is not fatal on its own;
        // it only matters if it then uses something undefined.
        return Ok(());
    };

    // Resolve to the library's own path so the same file is not loaded twice.
    let key = stdlib::FILES
        .iter()
        .find(|(_, src)| std::ptr::eq(*src, source))
        .map(|(p, _)| p.to_string())
        .unwrap_or_else(|| path.to_string());

    if !loaded.insert(key.clone()) {
        return Ok(());
    }

    let file = parser::parse(source).map_err(|e| Error {
        message: format!("{key}: syntax error: {e}"),
    })?;

    // Depth first, so a file's dependencies are registered before it.
    for import in &file.imports {
        collect_imports(&key, import, loaded, ordered)?;
    }

    ordered.push((key, file));
    Ok(())
}
