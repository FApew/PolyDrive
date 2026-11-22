//! Turns an evaluated `.mr` engine into an [`EngineConfig`].
//!
//! This is where the two object models meet. The original describes an engine
//! as parts wired together; this crate wants a flat configuration, and does not
//! model everything the original does — see the notes on each section for what
//! is dropped and why.

use super::builtins::function_from_object;
use super::eval::EvalError;
use super::value::{ObjectRef, Value};
use crate::config::{
    BankConfig, CylinderConfig, EngineConfig, ExhaustConfig, IntakeConfig, Preset,
};
use crate::units::*;

/// Anything the file asked for that this port cannot honour.
#[derive(Clone, Debug, Default)]
pub struct Warnings(pub Vec<String>);

impl Warnings {
    fn add(&mut self, message: impl Into<String>) {
        self.0.push(message.into());
    }
}

pub fn to_config(
    engine: &ObjectRef,
    vehicle: Option<&ObjectRef>,
    transmission: Option<&ObjectRef>,
    warnings: &mut Warnings,
) -> Result<EngineConfig, EvalError> {
    // Start from a preset so anything the file does not mention keeps a sane
    // value rather than a zero.
    let mut cfg = Preset::Inline4.config();
    let e = engine.borrow();

    cfg.name = e.string("name").unwrap_or_else(|| "Imported engine".into());
    cfg.simulation_frequency = e
        .number_or("simulation_frequency", 10000.0)
        .clamp(1000.0, 48000.0);

    cfg.starter_torque = e.number_or("starter_torque", cfg.starter_torque);
    if let Some(speed) = e.number("starter_speed") {
        // The original's starter speeds are low; keep the release speed above
        // it so the starter can still hand over.
        cfg.starter_speed = speed.abs();
        cfg.starter_release_speed = (speed.abs() * 2.5).max(rpm(500.0));
    }

    cfg.audio.df_f_mix = e.number_or("hf_gain", cfg.audio.df_f_mix as f64) as f32;
    cfg.audio.input_sample_noise =
        e.number_or("jitter", cfg.audio.input_sample_noise as f64) as f32;
    cfg.audio.air_noise = e.number_or("noise", cfg.audio.air_noise as f64) as f32;

    if let Some(throttle) = e.object("throttle") {
        let t = throttle.borrow();
        if t.kind == "direct_throttle_linkage" {
            cfg.throttle_gamma = t.number_or("gamma", cfg.throttle_gamma).max(0.01);
        } else {
            warnings.add(format!(
                "throttle type `{}` is not modelled; using a direct linkage",
                t.kind
            ));
        }
    }

    if let Some(fuel) = e.object("fuel") {
        let f = fuel.borrow();
        cfg.fuel.molecular_mass = f.number_or("molecular_mass", cfg.fuel.molecular_mass);
        cfg.fuel.energy_density = f.number_or("energy_density", cfg.fuel.energy_density);
        cfg.fuel.molecular_afr = f.number_or("molecular_afr", cfg.fuel.molecular_afr);
        cfg.fuel.max_burning_efficiency =
            f.number_or("max_burning_efficiency", cfg.fuel.max_burning_efficiency);
        cfg.fuel.burning_efficiency_randomness = f.number_or(
            "burning_efficiency_randomness",
            cfg.fuel.burning_efficiency_randomness,
        );
        cfg.fuel.low_efficiency_attenuation = f.number_or(
            "low_efficiency_attenuation",
            cfg.fuel.low_efficiency_attenuation,
        );
        cfg.fuel.max_turbulence_effect =
            f.number_or("max_turbulence_effect", cfg.fuel.max_turbulence_effect);
        cfg.fuel.max_dilution_effect =
            f.number_or("max_dilution_effect", cfg.fuel.max_dilution_effect);
        if let Some(curve) = f.object("turbulence_to_flame_speed_ratio") {
            cfg.fuel.turbulence_to_flame_speed_ratio = function_from_object(&curve);
        }
    }

    // --- crankshaft ------------------------------------------------------
    let crankshafts = e.objects("crankshafts");
    let Some(crank) = crankshafts.first().cloned() else {
        return Err(EvalError {
            message: "the engine has no crankshaft".into(),
        });
    };
    if crankshafts.len() > 1 {
        warnings.add(format!(
            "{} crankshafts; only the first is simulated",
            crankshafts.len()
        ));
    }
    {
        let c = crank.borrow();
        cfg.crank_throw = c.number_or("throw", cfg.crank_throw).abs().max(1e-4);
        cfg.moment_of_inertia = c
            .number_or("moment_of_inertia", cfg.moment_of_inertia)
            .max(1e-4);
        cfg.friction_torque = c.number_or("friction_torque", cfg.friction_torque).max(0.0);
    }

    // Rod journals, in the order they were added: a cylinder names one of them.
    let journals = crank.borrow().objects("rod_journals");

    // --- banks and cylinders ---------------------------------------------
    let banks = e.objects("banks");
    if banks.is_empty() {
        return Err(EvalError {
            message: "the engine has no cylinder banks".into(),
        });
    }

    cfg.banks.clear();
    cfg.cylinders.clear();
    cfg.exhausts.clear();
    cfg.intakes.clear();

    // Distinct exhaust systems and intakes, keyed by identity, in first-seen
    // order — several cylinders normally share one.
    let mut exhaust_objects: Vec<ObjectRef> = Vec::new();
    let mut intake_objects: Vec<ObjectRef> = Vec::new();
    // Ignition wire -> cylinder index, so the firing order can be recovered.
    let mut wire_order: Vec<(ObjectRef, usize)> = Vec::new();

    let mut heads: Vec<Option<ObjectRef>> = Vec::new();

    for bank in &banks {
        let b = bank.borrow();
        cfg.banks.push(BankConfig {
            angle: b.number_or("angle", 0.0),
        });
        let bank_index = cfg.banks.len() - 1;

        if cfg.banks.len() == 1 {
            cfg.bore = b.number_or("bore", cfg.bore).max(1e-4);
            cfg.deck_height = b.number_or("deck_height", cfg.deck_height);
        }

        heads.push(b.object("cylinder_head"));

        for cylinder in b.objects("cylinders") {
            let c = cylinder.borrow();

            let journal_angle = c
                .object("rod_journal")
                .and_then(|j| j.borrow().number("angle"))
                .unwrap_or_else(|| {
                    // Fall back to positional order if the journal is unnamed.
                    journals
                        .get(cfg.cylinders.len())
                        .and_then(|j| j.borrow().number("angle"))
                        .unwrap_or(0.0)
                });

            let exhaust = c.object("exhaust_system");
            let exhaust_index = match &exhaust {
                Some(o) => index_of(&mut exhaust_objects, o),
                None => 0,
            };
            let intake = c.object("intake");
            let intake_index = match &intake {
                Some(o) => index_of(&mut intake_objects, o),
                None => 0,
            };

            if let Some(wire) = c.object("ignition_wire") {
                wire_order.push((wire, cfg.cylinders.len()));
            }

            // Piston and rod geometry: the first cylinder sets the shared
            // values, since this port has one set for the whole engine.
            if cfg.cylinders.is_empty() {
                if let Some(piston) = c.object("piston") {
                    let p = piston.borrow();
                    cfg.compression_height =
                        p.number_or("compression_height", cfg.compression_height);
                    cfg.piston_displacement = p.number_or("displacement", 0.0);
                    cfg.blowby_k = p.number_or("blowby", cfg.blowby_k).max(0.0);
                }
                if let Some(rod) = c.object("connecting_rod") {
                    cfg.rod_length = rod.borrow().number_or("length", cfg.rod_length).max(1e-4);
                }
            }

            cfg.cylinders.push(CylinderConfig {
                bank: bank_index,
                journal_angle,
                exhaust: exhaust_index,
                intake: intake_index,
                sound_attenuation: c.number_or("sound_attenuation", 1.0),
                header_primary_length: c.number_or("primary_length", 0.0).max(0.0),
                ignition_angle: 0.0,
            });
        }
    }

    if cfg.cylinders.is_empty() {
        return Err(EvalError {
            message: "the engine has no cylinders".into(),
        });
    }

    // --- head ------------------------------------------------------------
    // One head per bank in the original; this port has one set of port flow
    // curves and runner sizes for the whole engine, so the first is used.
    let distinct_heads = heads.iter().flatten().count();
    if let Some(head) = heads.iter().flatten().next() {
        let h = head.borrow();
        cfg.chamber_volume = h.number_or("chamber_volume", cfg.chamber_volume).max(1e-9);
        cfg.intake_runner_volume = h
            .number_or("intake_runner_volume", cfg.intake_runner_volume)
            .max(1e-9);
        cfg.intake_runner_cross_section_area = h
            .number_or(
                "intake_runner_cross_section_area",
                cfg.intake_runner_cross_section_area,
            )
            .max(1e-9);
        cfg.exhaust_runner_volume = h
            .number_or("exhaust_runner_volume", cfg.exhaust_runner_volume)
            .max(1e-9);
        cfg.exhaust_runner_cross_section_area = h
            .number_or(
                "exhaust_runner_cross_section_area",
                cfg.exhaust_runner_cross_section_area,
            )
            .max(1e-9);

        if let Some(flow) = h.object("intake_port_flow") {
            cfg.intake_port_flow = function_from_object(&flow);
        }
        if let Some(flow) = h.object("exhaust_port_flow") {
            cfg.exhaust_port_flow = function_from_object(&flow);
        }

        if let Some(valvetrain) = h.object("valvetrain") {
            let v = valvetrain.borrow();
            if v.kind == "vtec_valvetrain" {
                warnings.add("VTEC is not modelled; the low-lift cam is used throughout");
            }
            if let Some(cam) = v.object("intake_camshaft") {
                apply_camshaft(&cam, &mut cfg, true);
            }
            if let Some(cam) = v.object("exhaust_camshaft") {
                apply_camshaft(&cam, &mut cfg, false);
            }
        }
    }
    if distinct_heads > 1 {
        warnings
            .add("this port uses one cylinder head for the whole engine; the first bank's is used");
    }

    // --- intake ----------------------------------------------------------
    if intake_objects.is_empty() {
        cfg.intakes.push(IntakeConfig::default());
    }
    for intake in &intake_objects {
        let i = intake.borrow();
        let d = IntakeConfig::default();
        cfg.intakes.push(IntakeConfig {
            plenum_volume: i.number_or("plenum_volume", d.plenum_volume).max(1e-9),
            plenum_cross_section_area: i
                .number_or("plenum_cross_section_area", d.plenum_cross_section_area)
                .max(1e-9),
            input_flow_k: i.number_or("intake_flow_rate", d.input_flow_k).max(0.0),
            idle_flow_k: i.number_or("idle_flow_rate", d.idle_flow_k).max(0.0),
            runner_flow_rate: i.number_or("runner_flow_rate", d.runner_flow_rate).max(0.0),
            runner_length: i.number_or("runner_length", d.runner_length).max(1e-4),
            molecular_afr: i.number_or("molecular_afr", d.molecular_afr),
            idle_throttle_plate_position: i
                .number_or(
                    "idle_throttle_plate_position",
                    d.idle_throttle_plate_position,
                )
                .clamp(0.0, 1.0),
            velocity_decay: i.number_or("velocity_decay", d.velocity_decay).max(0.0),
        });
    }
    if cfg.intakes.len() > 1 {
        // Multiple intakes are supported; a cylinder already points at its own.
        warnings.add(format!("{} separate intakes", cfg.intakes.len()));
    }

    // --- exhaust ---------------------------------------------------------
    if exhaust_objects.is_empty() {
        cfg.exhausts.push(ExhaustConfig::default());
    }
    for exhaust in &exhaust_objects {
        let x = exhaust.borrow();
        let d = ExhaustConfig::default();
        cfg.exhausts.push(ExhaustConfig {
            length: x.number_or("length", d.length).max(1e-3),
            collector_cross_section_area: x
                .number_or(
                    "collector_cross_section_area",
                    d.collector_cross_section_area,
                )
                .max(1e-9),
            outlet_flow_rate: x.number_or("outlet_flow_rate", d.outlet_flow_rate).max(0.0),
            primary_tube_length: x
                .number_or("primary_tube_length", d.primary_tube_length)
                .max(0.0),
            primary_flow_rate: x
                .number_or("primary_flow_rate", d.primary_flow_rate)
                .max(0.0),
            velocity_decay: x.number_or("velocity_decay", d.velocity_decay).max(0.0),
            audio_volume: x.number_or("audio_volume", d.audio_volume),
        });
        if x.get("impulse_response").is_some() {
            // Impulse responses name a .wav in the original's asset tree, which
            // we have no access to.
            warnings.add(
                "the file names an impulse response from the original's sound library; \
                 load your own with setImpulseResponse",
            );
        }
    }

    // --- ignition --------------------------------------------------------
    let modules = e.objects("ignition_modules");
    if let Some(module) = modules.first() {
        let m = module.borrow();
        cfg.rev_limit = m.number_or("rev_limit", cfg.rev_limit).abs();
        cfg.limiter_duration = m
            .number_or("limiter_duration", cfg.limiter_duration)
            .max(0.0);
        if let Some(curve) = m.object("timing_curve") {
            cfg.timing_curve = function_from_object(&curve);
        }

        // Each connection ties a wire to a cycle angle; a cylinder holds the
        // same wire, which is how the firing order is expressed.
        let mut firing: Vec<(f64, usize)> = Vec::new();
        for connection in m.objects("connections") {
            let c = connection.borrow();
            let Some(wire) = c.object("wire") else {
                continue;
            };
            let angle = c.number_or("angle", 0.0);
            if let Some((_, cylinder)) = wire_order
                .iter()
                .find(|(w, _)| std::rc::Rc::ptr_eq(w, &wire))
            {
                firing.push((angle, *cylinder));
            }
        }
        firing.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

        if firing.len() == cfg.cylinders.len() {
            // Use the file's angles verbatim. The presets derive firing angles
            // from crank geometry, snapping each cylinder to its nearest
            // compression TDC, because a hand-written firing order is easy to
            // get wrong. A file that states an angle for every wire is not
            // guessing, and the original obeys it exactly, so this does too.
            for (angle, cylinder) in &firing {
                cfg.cylinders[*cylinder].ignition_angle = positive_mod(*angle, 4.0 * PI);
            }
        } else {
            warnings.add(format!(
                "{} of {} cylinders have an ignition wire; firing order derived from cylinder order",
                firing.len(),
                cfg.cylinders.len()
            ));
            let order: Vec<usize> = (0..cfg.cylinders.len()).collect();
            cfg.resolve_firing_order(&order);
        }
    } else {
        warnings.add("no ignition module; firing evenly in cylinder order");
        let order: Vec<usize> = (0..cfg.cylinders.len()).collect();
        cfg.resolve_firing_order(&order);
    }

    // The original measures cycle angles from bank 0's axis.
    cfg.tdc = e
        .objects("crankshafts")
        .first()
        .and_then(|c| c.borrow().number("tdc"))
        .unwrap_or(cfg.banks[0].angle + PI / 2.0);

    // The vehicle and gearbox, which the file usually describes.
    if let Some(vehicle) = vehicle {
        let v = vehicle.borrow();
        let d = &cfg.vehicle;
        cfg.vehicle = crate::drivetrain::VehicleConfig {
            mass: v.number_or("mass", d.mass).max(1.0),
            drag_coefficient: v.number_or("drag_coefficient", d.drag_coefficient).max(0.0),
            frontal_area: v
                .number_or("cross_sectional_area", d.frontal_area)
                .max(0.01),
            tire_radius: v.number_or("tire_radius", d.tire_radius).max(0.01),
            rolling_resistance: v
                .number_or("rolling_resistance", d.rolling_resistance)
                .max(0.0),
            final_drive: v.number_or("diff_ratio", d.final_drive).max(0.01),
            ..cfg.vehicle.clone()
        };
    }
    if let Some(transmission) = transmission {
        let t = transmission.borrow();
        let ratios: Vec<f64> = t
            .list("gears")
            .iter()
            .filter_map(Value::as_number)
            .filter(|r| r.abs() > 1e-6)
            .collect();
        if !ratios.is_empty() {
            cfg.vehicle.gear_ratios = ratios;
        }
        let clutch = t.number_or("max_clutch_torque", cfg.vehicle.max_clutch_torque);
        if clutch > 0.0 {
            cfg.vehicle.max_clutch_torque = clutch;
        }
    }

    // Derived from swept volume, as for the built-in presets.
    cfg.windage_coefficient = 0.030 * cfg.displacement();

    // These are real engines with real inertia and no idle-air circuit, and
    // several take fifteen seconds of cranking to catch — as they do in the
    // original, where you hold the starter and feed it throttle.
    cfg.starter_timeout = 25.0;

    Ok(cfg)
}

fn apply_camshaft(cam: &ObjectRef, cfg: &mut EngineConfig, intake: bool) {
    let c = cam.borrow();
    if let Some(profile) = c.object("lobe_profile") {
        let f = function_from_object(&profile);
        if intake {
            cfg.intake_lobe_profile = f;
        } else {
            cfg.exhaust_lobe_profile = f;
        }
    }

    // The original places each lobe at an absolute centreline; this port
    // derives lobe positions from the firing order and a single lobe centre, so
    // recover that centre from the first lobe relative to its cylinder's TDC.
    let lobes: Vec<f64> = c
        .list("lobes")
        .iter()
        .filter_map(Value::as_number)
        .collect();
    if let Some(first) = lobes.first() {
        // Centrelines are written as `360deg -+ centre + offset`; the offset for
        // the first lobe of a camshaft is zero in every stock file.
        let centre = if intake {
            first - 2.0 * PI
        } else {
            2.0 * PI - first
        };
        let centre = positive_mod(centre, 2.0 * PI);
        if centre > 60.0 * DEG && centre < 160.0 * DEG {
            if intake {
                cfg.intake_lobe_center = centre;
            } else {
                cfg.exhaust_lobe_center = centre;
            }
        }
    }

    cfg.cam_advance = c.number_or("advance", cfg.cam_advance);
}

/// Index of an object in a list by identity, appending if it is new.
fn index_of(list: &mut Vec<ObjectRef>, object: &ObjectRef) -> usize {
    if let Some(i) = list.iter().position(|o| std::rc::Rc::ptr_eq(o, object)) {
        return i;
    }
    list.push(object.clone());
    list.len() - 1
}
