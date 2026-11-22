//! Raw C ABI, used by the WebAssembly build.
//!
//! Deliberately not `wasm-bindgen`: an `AudioWorkletProcessor` runs in a scope
//! with no `fetch`, no DOM and no module loader, so the glue has to instantiate
//! a bare `WebAssembly.Module` from bytes passed over the port. A flat C ABI
//! makes that glue about forty lines of hand-written JavaScript, and the crate
//! builds with plain `cargo build --target wasm32-unknown-unknown` — no
//! `wasm-pack`, no `wasm-bindgen-cli`.
//!
//! Ownership rules:
//! * `es_config_*` returns a config handle you own; `es_new` consumes it.
//! * `es_destroy` frees an engine handle.
//! * Buffers from `es_alloc` must be released with `es_dealloc`.

use crate::config::{BankConfig, CylinderConfig, EngineConfig, ExhaustConfig, Preset};
use crate::function::harmonic_cam_lobe;
use crate::sim::SoundEngine;
use crate::synth::AudioParameters;
use crate::units::PI;

pub const ABI_VERSION: u32 = 1;

// --- config keys ------------------------------------------------------------

pub const CFG_SIMULATION_FREQUENCY: u32 = 0;
pub const CFG_FLUID_SIMULATION_STEPS: u32 = 1;
pub const CFG_CRANK_THROW: u32 = 2;
pub const CFG_MOMENT_OF_INERTIA: u32 = 3;
pub const CFG_FRICTION_TORQUE: u32 = 4;
pub const CFG_TDC: u32 = 5;
pub const CFG_BORE: u32 = 6;
pub const CFG_ROD_LENGTH: u32 = 7;
pub const CFG_COMPRESSION_HEIGHT: u32 = 8;
pub const CFG_CHAMBER_VOLUME: u32 = 9;
pub const CFG_DECK_HEIGHT: u32 = 10;
pub const CFG_INTAKE_RUNNER_VOLUME: u32 = 11;
pub const CFG_INTAKE_RUNNER_AREA: u32 = 12;
pub const CFG_EXHAUST_RUNNER_VOLUME: u32 = 13;
pub const CFG_EXHAUST_RUNNER_AREA: u32 = 14;
pub const CFG_INTAKE_LOBE_CENTER: u32 = 15;
pub const CFG_EXHAUST_LOBE_CENTER: u32 = 16;
pub const CFG_CAM_ADVANCE: u32 = 17;
pub const CFG_REV_LIMIT: u32 = 18;
pub const CFG_LIMITER_DURATION: u32 = 19;
pub const CFG_CRANKCASE_PRESSURE: u32 = 20;
pub const CFG_STARTER_TORQUE: u32 = 21;
pub const CFG_STARTER_SPEED: u32 = 22;
pub const CFG_THROTTLE_GAMMA: u32 = 23;
pub const CFG_BLOWBY_K: u32 = 24;
pub const CFG_PISTON_DISPLACEMENT: u32 = 25;
pub const CFG_INTAKE_PLENUM_VOLUME: u32 = 26;
pub const CFG_INTAKE_PLENUM_AREA: u32 = 27;
pub const CFG_INTAKE_INPUT_FLOW_K: u32 = 28;
pub const CFG_INTAKE_IDLE_FLOW_K: u32 = 29;
pub const CFG_INTAKE_RUNNER_FLOW_RATE: u32 = 30;
pub const CFG_INTAKE_RUNNER_LENGTH: u32 = 31;
pub const CFG_INTAKE_IDLE_PLATE_POSITION: u32 = 32;
pub const CFG_INTAKE_VELOCITY_DECAY: u32 = 33;
pub const CFG_MAX_BURNING_EFFICIENCY: u32 = 34;
pub const CFG_WINDAGE_COEFFICIENT: u32 = 35;
pub const CFG_STARTER_RELEASE_SPEED: u32 = 36;
pub const CFG_STARTER_TIMEOUT: u32 = 37;

// --- vehicle keys -----------------------------------------------------------

pub const VEHICLE_MASS: u32 = 0;
pub const VEHICLE_DRAG_COEFFICIENT: u32 = 1;
pub const VEHICLE_FRONTAL_AREA: u32 = 2;
pub const VEHICLE_TIRE_RADIUS: u32 = 3;
pub const VEHICLE_ROLLING_RESISTANCE: u32 = 4;
pub const VEHICLE_FINAL_DRIVE: u32 = 5;
pub const VEHICLE_DRIVELINE_EFFICIENCY: u32 = 6;
pub const VEHICLE_MAX_CLUTCH_TORQUE: u32 = 7;
pub const VEHICLE_CLUTCH_STIFFNESS: u32 = 8;

// --- audio parameter keys ---------------------------------------------------

pub const AUDIO_VOLUME: u32 = 0;
pub const AUDIO_CONVOLUTION: u32 = 1;
pub const AUDIO_DF_F_MIX: u32 = 2;
pub const AUDIO_INPUT_SAMPLE_NOISE: u32 = 3;
pub const AUDIO_INPUT_SAMPLE_NOISE_CUTOFF: u32 = 4;
pub const AUDIO_AIR_NOISE: u32 = 5;
pub const AUDIO_AIR_NOISE_CUTOFF: u32 = 6;
pub const AUDIO_LEVELER_TARGET: u32 = 7;
pub const AUDIO_LEVELER_MAX_GAIN: u32 = 8;
pub const AUDIO_LEVELER_MIN_GAIN: u32 = 9;

// --- memory -----------------------------------------------------------------

/// Allocates `len` bytes for the host to write into.
#[no_mangle]
pub extern "C" fn es_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return core::ptr::null_mut();
    }
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

/// Frees a buffer returned by [`es_alloc`].
///
/// # Safety
/// `ptr` must come from `es_alloc` with the same `len`.
#[no_mangle]
pub unsafe extern "C" fn es_dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    drop(Vec::from_raw_parts(ptr, 0, len));
}

#[no_mangle]
pub extern "C" fn es_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn es_preset_count() -> u32 {
    Preset::all().len() as u32
}

/// Flow constant from a carburettor rating (SCFM at 1.5 inHg), for the
/// intake and exhaust flow parameters.
#[no_mangle]
pub extern "C" fn es_k_carb(flow_rate_scfm: f64) -> f64 {
    crate::gas::k_carb(flow_rate_scfm)
}

/// Flow constant from a head flow-bench rating (SCFM at 28 inH2O).
#[no_mangle]
pub extern "C" fn es_k_28in_h2o(flow_rate_scfm: f64) -> f64 {
    crate::gas::k_28in_h2o(flow_rate_scfm)
}

/// rad/s from RPM, for the rev limit and starter speed parameters.
#[no_mangle]
pub extern "C" fn es_rpm_to_rad_s(rpm: f64) -> f64 {
    crate::units::rpm(rpm)
}

// --- config -----------------------------------------------------------------

/// Creates a config handle from a preset id. Returns null for unknown ids.
#[no_mangle]
pub extern "C" fn es_config_new(preset_id: u32) -> *mut EngineConfig {
    match Preset::from_id(preset_id) {
        Some(p) => Box::into_raw(Box::new(p.config())),
        None => core::ptr::null_mut(),
    }
}

/// # Safety
/// `cfg` must be a live handle from [`es_config_new`] that has not been consumed.
#[no_mangle]
pub unsafe extern "C" fn es_config_free(cfg: *mut EngineConfig) {
    if !cfg.is_null() {
        drop(Box::from_raw(cfg));
    }
}

/// # Safety
/// `cfg` must be a live config handle.
#[no_mangle]
pub unsafe extern "C" fn es_config_set(cfg: *mut EngineConfig, key: u32, value: f64) {
    let Some(cfg) = cfg.as_mut() else { return };
    let intake = cfg.intakes.first_mut();

    match key {
        CFG_SIMULATION_FREQUENCY => cfg.simulation_frequency = value.max(1000.0),
        CFG_FLUID_SIMULATION_STEPS => {
            cfg.fluid_simulation_steps = (value.round().max(1.0) as usize).min(64)
        }
        CFG_CRANK_THROW => cfg.crank_throw = value,
        CFG_MOMENT_OF_INERTIA => cfg.moment_of_inertia = value.max(1e-6),
        CFG_FRICTION_TORQUE => cfg.friction_torque = value.max(0.0),
        CFG_TDC => cfg.tdc = value,
        CFG_BORE => cfg.bore = value.max(1e-4),
        CFG_ROD_LENGTH => cfg.rod_length = value.max(1e-4),
        CFG_COMPRESSION_HEIGHT => cfg.compression_height = value,
        CFG_CHAMBER_VOLUME => cfg.chamber_volume = value.max(1e-9),
        CFG_DECK_HEIGHT => cfg.deck_height = value,
        CFG_INTAKE_RUNNER_VOLUME => cfg.intake_runner_volume = value.max(1e-9),
        CFG_INTAKE_RUNNER_AREA => cfg.intake_runner_cross_section_area = value.max(1e-9),
        CFG_EXHAUST_RUNNER_VOLUME => cfg.exhaust_runner_volume = value.max(1e-9),
        CFG_EXHAUST_RUNNER_AREA => cfg.exhaust_runner_cross_section_area = value.max(1e-9),
        CFG_INTAKE_LOBE_CENTER => cfg.intake_lobe_center = value,
        CFG_EXHAUST_LOBE_CENTER => cfg.exhaust_lobe_center = value,
        CFG_CAM_ADVANCE => cfg.cam_advance = value,
        CFG_REV_LIMIT => cfg.rev_limit = value,
        CFG_LIMITER_DURATION => cfg.limiter_duration = value.max(0.0),
        CFG_CRANKCASE_PRESSURE => cfg.crankcase_pressure = value,
        CFG_STARTER_TORQUE => cfg.starter_torque = value,
        CFG_STARTER_SPEED => cfg.starter_speed = value,
        CFG_THROTTLE_GAMMA => cfg.throttle_gamma = value.max(0.01),
        CFG_BLOWBY_K => cfg.blowby_k = value.max(0.0),
        CFG_PISTON_DISPLACEMENT => cfg.piston_displacement = value,
        CFG_MAX_BURNING_EFFICIENCY => cfg.fuel.max_burning_efficiency = value.clamp(0.0, 1.0),
        CFG_WINDAGE_COEFFICIENT => cfg.windage_coefficient = value.max(0.0),
        CFG_STARTER_RELEASE_SPEED => cfg.starter_release_speed = value.max(0.0),
        CFG_STARTER_TIMEOUT => cfg.starter_timeout = value.max(0.0),
        _ => {
            if let Some(intake) = intake {
                match key {
                    CFG_INTAKE_PLENUM_VOLUME => intake.plenum_volume = value.max(1e-9),
                    CFG_INTAKE_PLENUM_AREA => intake.plenum_cross_section_area = value.max(1e-9),
                    CFG_INTAKE_INPUT_FLOW_K => intake.input_flow_k = value.max(0.0),
                    CFG_INTAKE_IDLE_FLOW_K => intake.idle_flow_k = value.max(0.0),
                    CFG_INTAKE_RUNNER_FLOW_RATE => intake.runner_flow_rate = value.max(0.0),
                    CFG_INTAKE_RUNNER_LENGTH => intake.runner_length = value.max(1e-4),
                    CFG_INTAKE_IDLE_PLATE_POSITION => {
                        intake.idle_throttle_plate_position = value.clamp(0.0, 1.0)
                    }
                    CFG_INTAKE_VELOCITY_DECAY => intake.velocity_decay = value.max(0.0),
                    _ => {}
                }
            }
        }
    }
}

/// Which port flow curve [`es_config_set_port_flow`] targets.
pub const PORT_INTAKE: u32 = 0;
pub const PORT_EXHAUST: u32 = 1;

/// Sets one property of the car the engine is bolted into.
///
/// # Safety
/// `cfg` must be a live config handle.
#[no_mangle]
pub unsafe extern "C" fn es_config_set_vehicle(cfg: *mut EngineConfig, key: u32, value: f64) {
    let Some(cfg) = cfg.as_mut() else { return };
    let v = &mut cfg.vehicle;
    match key {
        VEHICLE_MASS => v.mass = value.max(1.0),
        VEHICLE_DRAG_COEFFICIENT => v.drag_coefficient = value.max(0.0),
        VEHICLE_FRONTAL_AREA => v.frontal_area = value.max(0.01),
        VEHICLE_TIRE_RADIUS => v.tire_radius = value.max(0.01),
        VEHICLE_ROLLING_RESISTANCE => v.rolling_resistance = value.max(0.0),
        VEHICLE_FINAL_DRIVE => v.final_drive = value.max(0.01),
        VEHICLE_DRIVELINE_EFFICIENCY => v.driveline_efficiency = value.clamp(0.05, 1.0),
        VEHICLE_MAX_CLUTCH_TORQUE => v.max_clutch_torque = value.max(0.0),
        VEHICLE_CLUTCH_STIFFNESS => v.clutch_stiffness = value.max(1.0),
        _ => {}
    }
}

/// Replaces the gearbox with the given ratios, first to top. Ratios of zero are
/// dropped; an empty list leaves the existing gearbox alone.
///
/// # Safety
/// `cfg` must be a live config handle; `ratios` must point to `len` `f64`s.
#[no_mangle]
pub unsafe extern "C" fn es_config_set_gears(
    cfg: *mut EngineConfig,
    ratios: *const f64,
    len: usize,
) {
    let Some(cfg) = cfg.as_mut() else { return };
    if ratios.is_null() || len == 0 {
        return;
    }
    let gears: Vec<f64> = core::slice::from_raw_parts(ratios, len)
        .iter()
        .copied()
        .filter(|r| r.abs() > 1e-6)
        .collect();
    if !gears.is_empty() {
        cfg.vehicle.gear_ratios = gears;
    }
}

/// Names the engine. UTF-8; invalid bytes are ignored.
///
/// # Safety
/// `cfg` must be a live config handle; `name` must point to `len` bytes.
#[no_mangle]
pub unsafe extern "C" fn es_config_set_name(cfg: *mut EngineConfig, name: *const u8, len: usize) {
    let Some(cfg) = cfg.as_mut() else { return };
    if name.is_null() || len == 0 {
        return;
    }
    if let Ok(text) = core::str::from_utf8(core::slice::from_raw_parts(name, len)) {
        cfg.name = text.to_string();
    }
}

/// Replaces a cylinder head's port flow curve.
///
/// `lifts` is valve lift in metres and `flows` the corresponding bench figure in
/// SCFM at 28 inH2O — the numbers a flow bench prints. Without this a custom
/// engine is stuck with its base preset's head, which for anything much smaller
/// or larger than that preset means the wrong breathing entirely.
///
/// `filter_radius` is the interpolation width in metres; the sample spacing is
/// the sensible choice, and 0 picks that automatically.
///
/// # Safety
/// `cfg` must be a live config handle; `lifts` and `flows` must each point to
/// `len` `f64`s.
#[no_mangle]
pub unsafe extern "C" fn es_config_set_port_flow(
    cfg: *mut EngineConfig,
    which: u32,
    lifts: *const f64,
    flows: *const f64,
    len: usize,
    filter_radius: f64,
) {
    let Some(cfg) = cfg.as_mut() else { return };
    if lifts.is_null() || flows.is_null() || len == 0 {
        return;
    }

    let lifts = core::slice::from_raw_parts(lifts, len);
    let flows = core::slice::from_raw_parts(flows, len);

    let radius = if filter_radius > 0.0 {
        filter_radius
    } else if len > 1 {
        let mut sorted = lifts.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
        let span = sorted[len - 1] - sorted[0];
        (span / (len as f64 - 1.0)).max(1e-6)
    } else {
        crate::units::THOU * 50.0
    };

    let mut f = crate::function::Function::new(radius);
    for i in 0..len {
        f.add_sample(lifts[i], crate::gas::k_28in_h2o(flows[i]));
    }

    match which {
        PORT_EXHAUST => cfg.exhaust_port_flow = f,
        _ => cfg.intake_port_flow = f,
    }
}

/// Replaces both cam lobe profiles.
///
/// # Safety
/// `cfg` must be a live config handle.
#[no_mangle]
pub unsafe extern "C" fn es_config_set_cam(
    cfg: *mut EngineConfig,
    intake_duration_rad: f64,
    intake_lift: f64,
    exhaust_duration_rad: f64,
    exhaust_lift: f64,
    gamma: f64,
) {
    let Some(cfg) = cfg.as_mut() else { return };
    let gamma = if gamma > 0.0 { gamma } else { 0.9 };

    if intake_duration_rad > 0.0 && intake_lift > 0.0 {
        cfg.intake_lobe_profile = harmonic_cam_lobe(intake_duration_rad, gamma, intake_lift, 256);
    }
    if exhaust_duration_rad > 0.0 && exhaust_lift > 0.0 {
        cfg.exhaust_lobe_profile =
            harmonic_cam_lobe(exhaust_duration_rad, gamma, exhaust_lift, 256);
    }
}

/// Drops the preset's banks, exhausts and cylinders so a custom layout can be
/// built up with the `es_config_add_*` calls.
///
/// # Safety
/// `cfg` must be a live config handle.
#[no_mangle]
pub unsafe extern "C" fn es_config_clear_layout(cfg: *mut EngineConfig) {
    let Some(cfg) = cfg.as_mut() else { return };
    cfg.banks.clear();
    cfg.exhausts.clear();
    cfg.cylinders.clear();
}

/// # Safety
/// `cfg` must be a live config handle.
#[no_mangle]
pub unsafe extern "C" fn es_config_add_bank(cfg: *mut EngineConfig, angle_rad: f64) -> u32 {
    let Some(cfg) = cfg.as_mut() else { return 0 };
    cfg.banks.push(BankConfig { angle: angle_rad });
    if cfg.banks.len() == 1 {
        cfg.tdc = angle_rad + PI / 2.0;
    }
    (cfg.banks.len() - 1) as u32
}

/// # Safety
/// `cfg` must be a live config handle.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn es_config_add_exhaust(
    cfg: *mut EngineConfig,
    length: f64,
    collector_cross_section_area: f64,
    outlet_flow_rate: f64,
    primary_tube_length: f64,
    primary_flow_rate: f64,
    velocity_decay: f64,
    audio_volume: f64,
) -> u32 {
    let Some(cfg) = cfg.as_mut() else { return 0 };
    cfg.exhausts.push(ExhaustConfig {
        length: length.max(1e-3),
        collector_cross_section_area: collector_cross_section_area.max(1e-9),
        outlet_flow_rate: outlet_flow_rate.max(0.0),
        primary_tube_length: primary_tube_length.max(0.0),
        primary_flow_rate: primary_flow_rate.max(0.0),
        velocity_decay: velocity_decay.max(0.0),
        audio_volume,
    });
    (cfg.exhausts.len() - 1) as u32
}

/// # Safety
/// `cfg` must be a live config handle.
#[no_mangle]
pub unsafe extern "C" fn es_config_add_cylinder(
    cfg: *mut EngineConfig,
    bank: u32,
    journal_angle_rad: f64,
    exhaust: u32,
    sound_attenuation: f64,
    header_primary_length: f64,
) -> u32 {
    let Some(cfg) = cfg.as_mut() else { return 0 };
    cfg.cylinders.push(CylinderConfig {
        bank: bank as usize,
        journal_angle: journal_angle_rad,
        exhaust: exhaust as usize,
        intake: 0,
        sound_attenuation,
        header_primary_length: header_primary_length.max(0.0),
        ignition_angle: 0.0,
    });
    (cfg.cylinders.len() - 1) as u32
}

/// Applies a firing order given as cylinder indices, deriving each cylinder's
/// compression-TDC cycle angle. Must be called after the cylinders are added.
///
/// # Safety
/// `cfg` must be a live config handle; `order` must point to `len` `u32`s.
#[no_mangle]
pub unsafe extern "C" fn es_config_set_firing_order(
    cfg: *mut EngineConfig,
    order: *const u32,
    len: usize,
) {
    let Some(cfg) = cfg.as_mut() else { return };
    if order.is_null() || len == 0 {
        return;
    }
    let slice = core::slice::from_raw_parts(order, len);
    let order: Vec<usize> = slice.iter().map(|&i| i as usize).collect();
    cfg.resolve_firing_order(&order);
}

/// # Safety
/// `cfg` must be a live config handle.
#[no_mangle]
pub unsafe extern "C" fn es_config_set_audio(cfg: *mut EngineConfig, key: u32, value: f32) {
    let Some(cfg) = cfg.as_mut() else { return };
    set_audio_param(&mut cfg.audio, key, value);
}

fn set_audio_param(p: &mut AudioParameters, key: u32, value: f32) {
    match key {
        AUDIO_VOLUME => p.volume = value,
        AUDIO_CONVOLUTION => p.convolution = value.clamp(0.0, 1.0),
        AUDIO_DF_F_MIX => p.df_f_mix = value.clamp(0.0, 1.0),
        AUDIO_INPUT_SAMPLE_NOISE => p.input_sample_noise = value.clamp(0.0, 1.0),
        AUDIO_INPUT_SAMPLE_NOISE_CUTOFF => p.input_sample_noise_frequency_cutoff = value.max(1.0),
        AUDIO_AIR_NOISE => p.air_noise = value.clamp(0.0, 1.0),
        AUDIO_AIR_NOISE_CUTOFF => p.air_noise_frequency_cutoff = value.max(1.0),
        AUDIO_LEVELER_TARGET => p.leveler_target = value.max(1.0),
        AUDIO_LEVELER_MAX_GAIN => p.leveler_max_gain = value.max(0.0),
        AUDIO_LEVELER_MIN_GAIN => p.leveler_min_gain = value.max(0.0),
        _ => {}
    }
}

fn get_audio_param(p: &AudioParameters, key: u32) -> f32 {
    match key {
        AUDIO_VOLUME => p.volume,
        AUDIO_CONVOLUTION => p.convolution,
        AUDIO_DF_F_MIX => p.df_f_mix,
        AUDIO_INPUT_SAMPLE_NOISE => p.input_sample_noise,
        AUDIO_INPUT_SAMPLE_NOISE_CUTOFF => p.input_sample_noise_frequency_cutoff,
        AUDIO_AIR_NOISE => p.air_noise,
        AUDIO_AIR_NOISE_CUTOFF => p.air_noise_frequency_cutoff,
        AUDIO_LEVELER_TARGET => p.leveler_target,
        AUDIO_LEVELER_MAX_GAIN => p.leveler_max_gain,
        AUDIO_LEVELER_MIN_GAIN => p.leveler_min_gain,
        _ => 0.0,
    }
}

// --- .mr files ---------------------------------------------------------------

/// The outcome of reading a `.mr` file: either a configuration or a message
/// explaining what went wrong, plus any warnings.
pub struct MrResult {
    config: Option<EngineConfig>,
    /// The error text when reading failed, or a JSON array of warnings when it
    /// succeeded. JSON rather than a separator so a warning containing
    /// punctuation, quotes or line breaks cannot corrupt the list.
    message: String,
}

/// Reads a `.mr` engine file. Never null; ask [`es_mr_ok`] what happened.
///
/// # Safety
/// `source` must point to `len` bytes of UTF-8.
#[no_mangle]
pub unsafe extern "C" fn es_mr_load(source: *const u8, len: usize) -> *mut MrResult {
    let result = if source.is_null() || len == 0 {
        MrResult {
            config: None,
            message: "the file is empty".into(),
        }
    } else {
        let bytes = core::slice::from_raw_parts(source, len);
        match core::str::from_utf8(bytes) {
            Err(_) => MrResult {
                config: None,
                message: "the file is not valid UTF-8".into(),
            },
            Ok(text) => match crate::mr::load(text) {
                Ok(loaded) => MrResult {
                    message: crate::mr::json::array(&loaded.warnings),
                    config: Some(loaded.config),
                },
                Err(e) => MrResult {
                    config: None,
                    message: e.message,
                },
            },
        }
    };

    Box::into_raw(Box::new(result))
}

/// Non-zero if the file was read successfully.
///
/// # Safety
/// `result` must come from [`es_mr_load`].
#[no_mangle]
pub unsafe extern "C" fn es_mr_ok(result: *mut MrResult) -> u32 {
    match result.as_ref() {
        Some(r) => r.config.is_some() as u32,
        None => 0,
    }
}

/// UTF-8 message: the error text if it failed, or a JSON array of warnings if
/// it succeeded.
///
/// # Safety
/// `result` must come from [`es_mr_load`]; the pointer is valid until it is
/// freed.
#[no_mangle]
pub unsafe extern "C" fn es_mr_message_ptr(result: *mut MrResult) -> *const u8 {
    match result.as_ref() {
        Some(r) => r.message.as_ptr(),
        None => core::ptr::null(),
    }
}

/// # Safety
/// `result` must come from [`es_mr_load`].
#[no_mangle]
pub unsafe extern "C" fn es_mr_message_len(result: *mut MrResult) -> usize {
    match result.as_ref() {
        Some(r) => r.message.len(),
        None => 0,
    }
}

/// Takes the configuration out, ready for [`es_new`]. Returns null on failure,
/// and only works once.
///
/// # Safety
/// `result` must come from [`es_mr_load`].
#[no_mangle]
pub unsafe extern "C" fn es_mr_take_config(result: *mut MrResult) -> *mut EngineConfig {
    match result.as_mut() {
        Some(r) => match r.config.take() {
            Some(cfg) => Box::into_raw(Box::new(cfg)),
            None => core::ptr::null_mut(),
        },
        None => core::ptr::null_mut(),
    }
}

/// # Safety
/// `result` must come from [`es_mr_load`] and must not be used afterwards.
#[no_mangle]
pub unsafe extern "C" fn es_mr_free(result: *mut MrResult) {
    if !result.is_null() {
        drop(Box::from_raw(result));
    }
}

// --- engine -----------------------------------------------------------------

/// Builds an engine from a config handle. The handle is consumed; do not free
/// it afterwards. Returns null if `cfg` is null or describes no cylinders.
///
/// # Safety
/// `cfg` must be a live config handle from [`es_config_new`].
#[no_mangle]
pub unsafe extern "C" fn es_new(cfg: *mut EngineConfig, sample_rate: f32) -> *mut SoundEngine {
    if cfg.is_null() {
        return core::ptr::null_mut();
    }
    let cfg = *Box::from_raw(cfg);

    if cfg.cylinders.is_empty() || cfg.banks.is_empty() || cfg.exhausts.is_empty() {
        return core::ptr::null_mut();
    }

    let sample_rate = if sample_rate.is_finite() && sample_rate > 1000.0 {
        sample_rate as f64
    } else {
        44100.0
    };

    Box::into_raw(Box::new(SoundEngine::new(cfg, sample_rate)))
}

/// Convenience: preset straight to engine.
#[no_mangle]
pub extern "C" fn es_new_preset(preset_id: u32, sample_rate: f32) -> *mut SoundEngine {
    match Preset::from_id(preset_id) {
        Some(p) => unsafe { es_new(Box::into_raw(Box::new(p.config())), sample_rate) },
        None => core::ptr::null_mut(),
    }
}

/// # Safety
/// `engine` must be a live handle from [`es_new`].
#[no_mangle]
pub unsafe extern "C" fn es_destroy(engine: *mut SoundEngine) {
    if !engine.is_null() {
        drop(Box::from_raw(engine));
    }
}

macro_rules! with_engine {
    ($engine:expr, $default:expr, |$e:ident| $body:expr) => {{
        match unsafe { $engine.as_mut() } {
            Some($e) => $body,
            None => $default,
        }
    }};
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_set_throttle(engine: *mut SoundEngine, throttle: f32) {
    with_engine!(engine, (), |e| e.set_throttle(throttle as f64))
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_set_starter(engine: *mut SoundEngine, enabled: u32) {
    with_engine!(engine, (), |e| e.set_starter(enabled != 0))
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_set_ignition(engine: *mut SoundEngine, enabled: u32) {
    with_engine!(engine, (), |e| e.set_ignition(enabled != 0))
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_set_load_torque(engine: *mut SoundEngine, torque: f32) {
    with_engine!(engine, (), |e| e.set_load_torque(torque as f64))
}

/// Forces the crank speed. Useful for demos that drive RPM directly instead of
/// letting combustion decide.
///
/// Selects a gear. Negative, or past the top gear, means neutral.
///
/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_set_gear(engine: *mut SoundEngine, gear: i32) {
    with_engine!(engine, (), |e| {
        e.set_gear(if gear < 0 { None } else { Some(gear as usize) })
    })
}

/// The selected gear, or -1 for neutral.
///
/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_gear(engine: *mut SoundEngine) -> i32 {
    with_engine!(engine, -1, |e| e.gear().map_or(-1, |g| g as i32))
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_gear_count(engine: *mut SoundEngine) -> u32 {
    with_engine!(engine, 0, |e| e.gear_count() as u32)
}

/// Road speed, m/s.
///
/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_road_speed(engine: *mut SoundEngine) -> f32 {
    with_engine!(engine, 0.0, |e| e.road_speed() as f32)
}

/// Puts the car back at a standstill without touching the engine.
///
/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_reset_road_speed(engine: *mut SoundEngine) {
    with_engine!(engine, (), |e| e.engine.reset_road_speed())
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_set_rpm(engine: *mut SoundEngine, rpm: f32) {
    with_engine!(engine, (), |e| e.set_rpm(rpm as f64))
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_rpm(engine: *mut SoundEngine) -> f32 {
    with_engine!(engine, 0.0, |e| e.rpm() as f32)
}

/// Non-zero while the starter is still cranking. Clears by itself once the
/// engine catches, or when the attempt times out.
///
/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_starter_engaged(engine: *mut SoundEngine) -> u32 {
    with_engine!(engine, 0, |e| e.starter_engaged() as u32)
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_manifold_pressure(engine: *mut SoundEngine) -> f32 {
    with_engine!(engine, 0.0, |e| e.manifold_pressure() as f32)
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_leveler_gain(engine: *mut SoundEngine) -> f32 {
    with_engine!(engine, 0.0, |e| e.synth.leveler_gain())
}

/// Total swept volume in m³ (multiply by 1000 for litres).
///
/// Derived from bore, stroke and cylinder count — there is no way to set it
/// directly, here or in the original.
///
/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_displacement(engine: *mut SoundEngine) -> f32 {
    with_engine!(engine, 0.0, |e| e.displacement() as f32)
}

/// The engine's name, UTF-8. Valid until the engine is destroyed or rebuilt.
///
/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_name_ptr(engine: *mut SoundEngine) -> *const u8 {
    with_engine!(engine, core::ptr::null(), |e| e.name().as_ptr())
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_name_len(engine: *mut SoundEngine) -> usize {
    with_engine!(engine, 0, |e| e.name().len())
}

/// Rev limit in rad/s.
///
/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_rev_limit(engine: *mut SoundEngine) -> f32 {
    with_engine!(engine, 0.0, |e| e.rev_limit() as f32)
}

/// Geometric compression ratio.
///
/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_compression_ratio(engine: *mut SoundEngine) -> f32 {
    with_engine!(engine, 0.0, |e| e.compression_ratio() as f32)
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_bank_count(engine: *mut SoundEngine) -> u32 {
    with_engine!(engine, 0, |e| e.bank_count() as u32)
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_cylinder_count(engine: *mut SoundEngine) -> u32 {
    with_engine!(engine, 0, |e| e.engine.cylinder_count() as u32)
}

/// Number of exhaust systems, i.e. synthesizer input channels.
///
/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_channel_count(engine: *mut SoundEngine) -> u32 {
    with_engine!(engine, 0, |e| e.synth.channel_count() as u32)
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_set_audio_param(engine: *mut SoundEngine, key: u32, value: f32) {
    with_engine!(engine, (), |e| {
        let mut params = e.audio_parameters();
        set_audio_param(&mut params, key, value);
        e.set_audio_parameters(params);
    })
}

/// # Safety
/// `engine` must be a live engine handle.
#[no_mangle]
pub unsafe extern "C" fn es_get_audio_param(engine: *mut SoundEngine, key: u32) -> f32 {
    with_engine!(engine, 0.0, |e| get_audio_param(&e.audio_parameters(), key))
}

/// Installs an impulse response from float samples at the engine's audio rate.
/// `channel < 0` applies it to every exhaust system.
///
/// # Safety
/// `engine` must be live; `data` must point to `len` `f32`s.
#[no_mangle]
pub unsafe extern "C" fn es_set_impulse_response(
    engine: *mut SoundEngine,
    channel: i32,
    data: *const f32,
    len: usize,
    volume: f32,
) {
    if data.is_null() || len == 0 {
        return;
    }
    let samples = core::slice::from_raw_parts(data, len);
    with_engine!(engine, (), |e| {
        if channel < 0 {
            e.set_impulse_response_all(samples, volume);
        } else {
            e.set_impulse_response(channel as usize, samples, volume);
        }
    })
}

/// Installs an impulse response from raw WAV file bytes, resampling if needed.
/// Returns the number of samples installed, or a negative error code.
///
/// # Safety
/// `engine` must be live; `data` must point to `len` bytes.
#[no_mangle]
pub unsafe extern "C" fn es_set_impulse_response_wav(
    engine: *mut SoundEngine,
    channel: i32,
    data: *const u8,
    len: usize,
    volume: f32,
    audio_sample_rate: f32,
) -> i32 {
    if data.is_null() || len == 0 {
        return -1;
    }
    let bytes = core::slice::from_raw_parts(data, len);
    let wav = match crate::wav::decode(bytes) {
        Ok(w) => w,
        Err(_) => return -2,
    };

    let target_rate = if audio_sample_rate.is_finite() && audio_sample_rate > 1000.0 {
        audio_sample_rate as f64
    } else {
        44100.0
    };
    let samples = crate::wav::resample(&wav.samples, wav.sample_rate as f64, target_rate);

    with_engine!(engine, -3, |e| {
        if channel < 0 {
            e.set_impulse_response_all(&samples, volume);
        } else {
            e.set_impulse_response(channel as usize, &samples, volume);
        }
        samples.len() as i32
    })
}

/// Renders `len` samples of mono audio into `out`.
///
/// # Safety
/// `engine` must be live; `out` must point to `len` writable `f32`s.
#[no_mangle]
pub unsafe extern "C" fn es_render(engine: *mut SoundEngine, out: *mut f32, len: usize) {
    if out.is_null() || len == 0 {
        return;
    }
    let buffer = core::slice::from_raw_parts_mut(out, len);
    match engine.as_mut() {
        Some(e) => e.render(buffer),
        None => buffer.fill(0.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_round_trip() {
        unsafe {
            let cfg = es_config_new(Preset::V8Crossplane.id());
            assert!(!cfg.is_null());
            es_config_set(cfg, CFG_SIMULATION_FREQUENCY, 10000.0);
            es_config_set_audio(cfg, AUDIO_VOLUME, 0.8);

            let engine = es_new(cfg, 44100.0);
            assert!(!engine.is_null());
            assert_eq!(es_cylinder_count(engine), 8);
            assert_eq!(es_channel_count(engine), 2);
            assert!((es_get_audio_param(engine, AUDIO_VOLUME) - 0.8).abs() < 1e-6);

            es_set_starter(engine, 1);
            es_set_throttle(engine, 0.3);

            let mut buf = vec![0.0f32; 4096];
            es_render(engine, buf.as_mut_ptr(), buf.len());
            assert!(buf.iter().all(|s| s.is_finite()));

            es_destroy(engine);
        }
    }

    #[test]
    fn custom_layout_via_abi() {
        unsafe {
            let cfg = es_config_new(Preset::Inline4.id());
            es_config_clear_layout(cfg);
            es_config_add_bank(cfg, 0.0);
            es_config_add_exhaust(
                cfg,
                2.5,
                0.002,
                crate::gas::k_carb(500.0),
                0.7,
                crate::gas::k_carb(300.0),
                0.5,
                0.2,
            );
            for (i, angle) in [0.0, PI, PI, 0.0].iter().enumerate() {
                es_config_add_cylinder(cfg, 0, *angle, 0, 1.0, 0.01 * (i as f64 + 1.0));
            }
            let order: [u32; 4] = [0, 2, 3, 1];
            es_config_set_firing_order(cfg, order.as_ptr(), order.len());

            let engine = es_new(cfg, 48000.0);
            assert!(!engine.is_null());
            assert_eq!(es_cylinder_count(engine), 4);
            assert_eq!(es_channel_count(engine), 1);

            let mut buf = vec![0.0f32; 2048];
            es_set_starter(engine, 1);
            es_render(engine, buf.as_mut_ptr(), buf.len());
            assert!(buf.iter().all(|s| s.is_finite()));
            es_destroy(engine);
        }
    }

    #[test]
    fn preset_ids_round_trip() {
        assert_eq!(es_preset_count() as usize, Preset::all().len());
        for (index, &preset) in Preset::all().iter().enumerate() {
            assert_eq!(preset.id() as usize, index);
            assert_eq!(Preset::from_id(index as u32), Some(preset));
        }
        assert_eq!(Preset::from_id(es_preset_count()), None);
    }

    #[test]
    fn null_handles_are_safe() {
        unsafe {
            es_destroy(core::ptr::null_mut());
            es_config_free(core::ptr::null_mut());
            assert_eq!(es_rpm(core::ptr::null_mut()), 0.0);
            let mut buf = [1.0f32; 8];
            es_render(core::ptr::null_mut(), buf.as_mut_ptr(), buf.len());
            assert!(buf.iter().all(|&s| s == 0.0));
            assert!(es_new(core::ptr::null_mut(), 44100.0).is_null());
            assert!(es_config_new(9999).is_null());
        }
    }
}
