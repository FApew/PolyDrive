//! Native implementations of the `__engine_sim__*` nodes.
//!
//! The standard library is interpreted as-is; only the nodes it binds with `=>`
//! are implemented here. Most are plain constructors that gather their declared
//! inputs into an object. The interesting ones are the actions, which attach
//! objects to one another, and the arithmetic and cast nodes.

use super::ast::NodeDef;
use super::eval::{collect_inputs, err, input, new_object, EvalError, Interpreter, Scope};
use super::value::{Object, Value};
use crate::units::{self, DEG, PI, THOU};
use std::rc::Rc;

/// Builds the value for a node bound to `native`.
pub fn construct(
    interp: &Interpreter,
    native: &str,
    scope: &Rc<Scope>,
    def: &NodeDef,
) -> Result<Value, EvalError> {
    let get = |name: &str| input(interp, scope, name);
    let num = |name: &str| get(name).as_number().unwrap_or(0.0);

    match native {
        // --- casts ---------------------------------------------------------
        "__engine_sim__int_to_float" => Ok(Value::Float(num("__in"))),
        "__engine_sim__int_to_string" => Ok(Value::Str(format!("{}", num("__in") as i64))),
        "__engine_sim__string_to_int" => Ok(Value::Int(match get("__in") {
            Value::Str(s) => s.trim().parse().unwrap_or(0),
            other => other.as_number().unwrap_or(0.0) as i64,
        })),

        // --- arithmetic ---------------------------------------------------
        "__engine_sim__float_add" => Ok(Value::Float(num("__in0") + num("__in1"))),
        "__engine_sim__float_subtract" => Ok(Value::Float(num("__in0") - num("__in1"))),
        "__engine_sim__float_multiply" => Ok(Value::Float(num("__in0") * num("__in1"))),
        "__engine_sim__float_divide" => Ok(Value::Float(num("__in0") / num("__in1"))),
        "__engine_sim__float_negate" => Ok(Value::Float(-num("__in"))),
        "__engine_sim__int_add" => Ok(Value::Int(num("__in0") as i64 + num("__in1") as i64)),
        "__engine_sim__int_subtract" => Ok(Value::Int(num("__in0") as i64 - num("__in1") as i64)),
        "__engine_sim__int_multiply" => Ok(Value::Int(num("__in0") as i64 * num("__in1") as i64)),
        "__engine_sim__int_divide" => {
            let d = num("__in1") as i64;
            if d == 0 {
                return err("division by zero");
            }
            Ok(Value::Int(num("__in0") as i64 / d))
        }
        "__engine_sim__int_negate" => Ok(Value::Int(-(num("__in") as i64))),
        "__engine_sim__string_add" => Ok(Value::Str(format!("{}{}", get("__in0"), get("__in1")))),

        // --- flow constants -----------------------------------------------
        "__engine_sim__k_carb" => Ok(Value::Float(crate::gas::k_carb(num("flow")))),
        "__engine_sim__k_28inH2O" => Ok(Value::Float(crate::gas::k_28in_h2o(num("flow")))),

        // --- plain constructors -------------------------------------------
        "__engine_sim__engine"
        | "__engine_sim__crankshaft"
        | "__engine_sim__rod_journal"
        | "__engine_sim__piston"
        | "__engine_sim__connecting_rod"
        | "__engine_sim__cylinder_bank"
        | "__engine_sim__cylinder_head"
        | "__engine_sim__camshaft"
        | "__engine_sim__intake"
        | "__engine_sim__exhaust_system"
        | "__engine_sim__ignition_module"
        | "__engine_sim__ignition_wire"
        | "__engine_sim__fuel"
        | "__engine_sim__impulse_response"
        | "__engine_sim__standard_valvetrain"
        | "__engine_sim__vtec_valvetrain"
        | "__engine_sim__direct_throttle_linkage"
        | "__engine_sim__governor"
        | "__engine_sim__vehicle"
        | "__engine_sim__transmission" => {
            let kind = native.trim_start_matches("__engine_sim__");
            let object = new_object(kind);
            collect_inputs(interp, scope, def, &object)?;
            Ok(Value::Object(object))
        }

        // A function is a curve that samples get added to.
        "__engine_sim__function" => {
            let object = new_object("function");
            collect_inputs(interp, scope, def, &object)?;
            Ok(Value::Object(object))
        }

        // --- actions -------------------------------------------------------
        "__engine_sim__add_rod_journal" => {
            attach(interp, scope, "crankshaft", "rod_journal", "rod_journals")
        }
        "__engine_sim__add_slave_journal" => {
            attach(interp, scope, "rod", "rod_journal", "rod_journals")
        }
        "__engine_sim__add_crankshaft" => {
            attach(interp, scope, "engine", "crankshaft", "crankshafts")
        }
        "__engine_sim__add_cylinder_bank" => {
            attach(interp, scope, "engine", "cylinder_bank", "banks")
        }
        "__engine_sim__add_ignition_module" => attach(
            interp,
            scope,
            "engine",
            "ignition_module",
            "ignition_modules",
        ),
        "__engine_sim__add_gear" => {
            let transmission = object_input(interp, scope, "transmission")?;
            let ratio = num("ratio");
            transmission.borrow_mut().push("gears", Value::Float(ratio));
            Ok(Value::Object(transmission))
        }
        "__engine_sim__add_lobe" => {
            let camshaft = object_input(interp, scope, "camshaft")?;
            camshaft
                .borrow_mut()
                .push("lobes", Value::Float(num("centerline")));
            Ok(Value::Object(camshaft))
        }
        "__engine_sim__add_sample" => {
            let function = object_input(interp, scope, "function")?;
            function
                .borrow_mut()
                .push("samples", Value::Float(num("x")));
            function
                .borrow_mut()
                .push("sample_values", Value::Float(num("y")));
            Ok(Value::Object(function))
        }
        "__engine_sim__add_cylinder" => {
            let bank = object_input(interp, scope, "cylinder_bank")?;
            let cylinder = Object::new("cylinder");
            for key in [
                "piston",
                "connecting_rod",
                "rod_journal",
                "intake",
                "exhaust_system",
                "ignition_wire",
                "sound_attenuation",
                "primary_length",
            ] {
                cylinder
                    .borrow_mut()
                    .props
                    .insert(key.to_string(), get(key));
            }
            bank.borrow_mut().push("cylinders", Value::Object(cylinder));
            Ok(Value::Object(bank))
        }
        "__engine_sim__set_cylinder_head" => {
            let bank = object_input(interp, scope, "bank")?;
            bank.borrow_mut()
                .props
                .insert("cylinder_head".to_string(), get("head"));
            Ok(Value::Object(bank))
        }
        "__engine_sim__connect_ignition_wire" => {
            let module = object_input(interp, scope, "ignition_module")?;
            let entry = Object::new("wire_connection");
            entry
                .borrow_mut()
                .props
                .insert("wire".to_string(), get("wire"));
            entry
                .borrow_mut()
                .props
                .insert("angle".to_string(), Value::Float(num("angle")));
            module
                .borrow_mut()
                .push("connections", Value::Object(entry));
            Ok(Value::Object(module))
        }

        // --- the harmonic cam lobe generator -------------------------------
        "__engine_sim__generate_harmonic_cam_lobe" => {
            let function = object_input(interp, scope, "function")?;
            let duration = num("duration_at_50_thou");
            let gamma = num("gamma");
            let lift = num("lift");
            let steps = num("steps").max(8.0) as usize;
            {
                let mut f = function.borrow_mut();
                f.props
                    .insert("harmonic_duration".to_string(), Value::Float(duration));
                f.props
                    .insert("harmonic_gamma".to_string(), Value::Float(gamma));
                f.props
                    .insert("harmonic_lift".to_string(), Value::Float(lift));
                f.props
                    .insert("harmonic_steps".to_string(), Value::Float(steps as f64));
            }
            Ok(Value::Object(function))
        }

        // --- entry points ---------------------------------------------------
        "__engine_sim__set_engine" => {
            let value = get("engine");
            match value.as_object() {
                Some(engine) => {
                    *interp.engine.borrow_mut() = Some(engine);
                    Ok(Value::Nil)
                }
                None => err("set_engine was not given an engine"),
            }
        }
        // The vehicle and gearbox reach the sound only through what they ask
        // of the engine, but that is enough to be worth keeping.
        "__engine_sim__set_vehicle" => {
            *interp.vehicle.borrow_mut() = get("vehicle").as_object();
            Ok(Value::Nil)
        }
        "__engine_sim__set_transmission" => {
            *interp.transmission.borrow_mut() = get("transmission").as_object();
            Ok(Value::Nil)
        }
        // Application settings are display preferences.
        "__engine_sim__set_application_settings" => Ok(Value::Nil),

        // Channel and literal declarations carry no behaviour.
        "__engine_sim__float"
        | "__engine_sim__int"
        | "__engine_sim__bool"
        | "__engine_sim__string"
        | "__engine_sim__literal_float"
        | "__engine_sim__literal_int"
        | "__engine_sim__literal_bool"
        | "__engine_sim__literal_string" => Ok(Value::Nil),
        other if other.ends_with("_channel") => Ok(Value::Nil),

        other => err(format!("`{other}` is not implemented")),
    }
}

fn object_input(
    interp: &Interpreter,
    scope: &Rc<Scope>,
    name: &str,
) -> Result<super::value::ObjectRef, EvalError> {
    match input(interp, scope, name).as_object() {
        Some(o) => Ok(o),
        None => err(format!("expected `{name}` to be an object")),
    }
}

/// `parent.add_x(child)`: push `child` onto the parent's list and return the
/// parent so chains keep working.
fn attach(
    interp: &Interpreter,
    scope: &Rc<Scope>,
    parent_input: &str,
    child_input: &str,
    list: &str,
) -> Result<Value, EvalError> {
    let parent = object_input(interp, scope, parent_input)?;
    let child = input(interp, scope, child_input);
    parent.borrow_mut().push(list, child);
    Ok(Value::Object(parent))
}

/// Rebuilds a `Function` from the samples collected during evaluation.
pub fn function_from_object(object: &super::value::ObjectRef) -> crate::function::Function {
    let o = object.borrow();

    // A harmonically generated cam lobe carries its parameters rather than
    // samples.
    if let Some(lift) = o.number("harmonic_lift") {
        let duration = o.number_or("harmonic_duration", 230.0 * DEG);
        let gamma = o.number_or("harmonic_gamma", 0.9);
        let steps = o.number_or("harmonic_steps", 256.0).max(8.0) as usize;
        if lift > 0.0 && duration > 0.0 {
            return crate::function::harmonic_cam_lobe(duration, gamma, lift, steps);
        }
    }

    let xs: Vec<f64> = o
        .list("samples")
        .iter()
        .filter_map(Value::as_number)
        .collect();
    let ys: Vec<f64> = o
        .list("sample_values")
        .iter()
        .filter_map(Value::as_number)
        .collect();

    let filter_radius = o.number_or("filter_radius", 1.0);
    let mut f = crate::function::Function::new(if filter_radius > 0.0 {
        filter_radius
    } else {
        1.0
    });
    for (x, y) in xs.iter().zip(ys.iter()) {
        f.add_sample(*x, *y);
    }
    f
}

/// Unit helpers, for turning `.mr` values into the crate's units where the
/// standard library expresses something in an odd one.
pub const THOU_PER_M: f64 = 1.0 / THOU;
pub const DEG_PER_RAD: f64 = 1.0 / DEG;
pub const FULL_CYCLE: f64 = 4.0 * PI;
pub const ATMOSPHERE: f64 = units::ATM;
