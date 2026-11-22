//! Engine runtime: intake, combustion chamber, exhaust, ignition, crank.
//!
//! Ports of `intake.cpp`, `combustion_chamber.cpp`, `exhaust_system.cpp`,
//! `ignition_module.cpp` and the cylinder kinematics.
//!
//! One deliberate departure from the original: the crankshaft, rods and pistons
//! are not run through a rigid-body constraint solver. That solver
//! (`simple-2d-constraint-solver`) exists to render moving parts and to model
//! the whole drivetrain; for sound, all that matters is where each piston is
//! and how fast the crank turns. Here the pistons follow exact slider-crank
//! kinematics from the crank angle, and the crank is a single inertia driven by
//! the same gas and friction forces the solver would have applied. Cylinder
//! pressure, valve timing, gas dynamics and the entire audio chain are
//! unchanged.

use crate::config::{CylinderConfig, EngineConfig, ExhaustConfig, IntakeConfig};
use crate::filters::Rng;
use crate::gas::{self, flow, FlowParameters, GasSystem, Mix};
use crate::units::*;

const STATE_SAMPLES: usize = 256;

/// `f64::signum` returns ±1 for ±0.0; friction needs a true zero there.
#[inline]
fn sign(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        0.0
    }
}

// ---------------------------------------------------------------------------
// Kinematics
// ---------------------------------------------------------------------------

/// Slider-crank solution for one cylinder.
///
/// `s` is the distance from the crank centreline to the wrist pin along the
/// bank axis; `ds_dtheta` is its derivative with respect to crank angle, which
/// doubles as the lever arm converting piston force into crank torque.
#[derive(Clone, Copy, Debug)]
pub struct PistonKinematics {
    pub s: f64,
    pub ds_dtheta: f64,
    /// Journal offset perpendicular to the bank axis; drives rod angularity.
    pub offset: f64,
}

#[inline]
pub fn piston_kinematics(
    theta: f64,
    journal_angle: f64,
    axis_angle: f64,
    crank_throw: f64,
    rod_length: f64,
) -> PistonKinematics {
    let psi = theta + journal_angle - axis_angle;
    let (sin_psi, cos_psi) = psi.sin_cos();

    let u = crank_throw * cos_psi;
    let du = -crank_throw * sin_psi;

    let inner = u * u + rod_length * rod_length - crank_throw * crank_throw;
    let w = if inner > 0.0 { inner.sqrt() } else { 0.0 };

    let ds_dtheta = if w > 0.0 { du * (1.0 + u / w) } else { du };

    PistonKinematics {
        s: u + w,
        ds_dtheta,
        offset: crank_throw * sin_psi,
    }
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

pub struct Intake {
    pub system: GasSystem,
    atmosphere: GasSystem,
    /// Throttle plate value: 1 = closed (idle), 0 = wide open.
    pub throttle: f64,
    pub flow: f64,
    pub flow_rate: f64,
    pub total_fuel_injected: f64,
    cfg: IntakeConfig,
}

impl Intake {
    pub fn new(cfg: &IntakeConfig) -> Self {
        let mut system = GasSystem::default();
        system.initialize(ATM, cfg.plenum_volume, celsius(25.0));
        system.set_geometry(
            cfg.plenum_cross_section_area.sqrt(),
            cfg.plenum_volume / cfg.plenum_cross_section_area,
            1.0,
            0.0,
        );

        Self {
            system,
            atmosphere: gas::atmosphere(1000.0 * M3, 100.0 * M),
            throttle: 1.0,
            flow: 0.0,
            flow_rate: 0.0,
            total_fuel_injected: 0.0,
            cfg: cfg.clone(),
        }
    }

    #[inline]
    pub fn throttle_plate_position(&self) -> f64 {
        self.cfg.idle_throttle_plate_position * self.throttle
    }

    pub fn runner_flow_rate(&self) -> f64 {
        self.cfg.runner_flow_rate
    }

    pub fn runner_length(&self) -> f64 {
        self.cfg.runner_length
    }

    pub fn plenum_cross_section_area(&self) -> f64 {
        self.cfg.plenum_cross_section_area
    }

    /// Port of `Intake::process`.
    pub fn process(&mut self, dt: f64) {
        let ideal_afr = 0.8 * self.cfg.molecular_afr * 4.0;
        let p_air = ideal_afr / (1.0 + ideal_afr);
        let fuel_air_mix = Mix {
            p_fuel: 1.0 - p_air,
            p_inert: p_air * 0.75,
            p_o2: p_air * 0.25,
        };

        let idle_afr = 2.0;
        let p_idle_air = idle_afr / (1.0 + idle_afr);
        let fuel_mix = Mix {
            p_fuel: 1.0 - p_idle_air,
            p_inert: p_idle_air * 0.75,
            p_o2: p_idle_air * 0.25,
        };

        let throttle = self.throttle_plate_position();
        let flow_attenuation = (throttle * PI / 2.0).cos();

        let mut params = FlowParameters {
            k_flow: 0.0,
            dt,
            direction_x: 0.0,
            direction_y: -1.0,
            cross_section_area_0: 10.0 * M2,
            cross_section_area_1: self.cfg.plenum_cross_section_area,
        };

        self.atmosphere.reset(ATM, celsius(25.0), fuel_air_mix);
        params.k_flow = flow_attenuation * self.cfg.input_flow_k;
        self.flow = flow(&params, &mut self.atmosphere, &mut self.system);

        self.atmosphere.reset(ATM, celsius(25.0), fuel_mix);
        params.k_flow = self.cfg.idle_flow_k;
        let idle_circuit_flow = flow(&params, &mut self.atmosphere, &mut self.system);

        self.system.dissipate_excess_velocity();
        self.system.update_velocity(dt, self.cfg.velocity_decay);

        if self.flow > 0.0 {
            self.total_fuel_injected += fuel_air_mix.p_fuel * self.flow;
        }
        if idle_circuit_flow > 0.0 {
            self.total_fuel_injected += fuel_mix.p_fuel * idle_circuit_flow;
        }
    }
}

// ---------------------------------------------------------------------------
// Exhaust
// ---------------------------------------------------------------------------

pub struct Exhaust {
    pub system: GasSystem,
    atmosphere: GasSystem,
    pub flow: f64,
    cfg: ExhaustConfig,
}

impl Exhaust {
    pub fn new(cfg: &ExhaustConfig) -> Self {
        let volume = cfg.collector_cross_section_area * cfg.length;
        let mut system = GasSystem::default();
        system.initialize(ATM, volume, celsius(25.0));
        system.set_geometry(
            cfg.length,
            cfg.collector_cross_section_area.sqrt(),
            1.0,
            0.0,
        );

        Self {
            system,
            atmosphere: gas::atmosphere(1000.0 * M3, 10.0 * M),
            flow: 0.0,
            cfg: cfg.clone(),
        }
    }

    pub fn length(&self) -> f64 {
        self.cfg.length
    }

    pub fn audio_volume(&self) -> f64 {
        self.cfg.audio_volume
    }

    pub fn primary_flow_rate(&self) -> f64 {
        self.cfg.primary_flow_rate
    }

    pub fn primary_tube_length(&self) -> f64 {
        self.cfg.primary_tube_length
    }

    pub fn collector_cross_section_area(&self) -> f64 {
        self.cfg.collector_cross_section_area
    }

    /// Port of `ExhaustSystem::process`.
    pub fn process(&mut self, dt: f64) {
        self.atmosphere.reset(ATM, celsius(25.0), Mix::default());

        let params = FlowParameters {
            k_flow: self.cfg.outlet_flow_rate,
            dt,
            direction_x: 1.0,
            direction_y: 0.0,
            cross_section_area_0: self.cfg.collector_cross_section_area,
            cross_section_area_1: 10.0 * M2,
        };

        self.flow = flow(&params, &mut self.atmosphere, &mut self.system);

        self.system.dissipate_excess_velocity();
        self.system.update_velocity(dt, self.cfg.velocity_decay);
    }
}

// ---------------------------------------------------------------------------
// Combustion chamber
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Default)]
struct FlameEvent {
    efficiency: f64,
    flame_speed: f64,
    last_volume: f64,
    travel_x: f64,
    travel_y: f64,
    global_mix: Mix,
}

pub struct Chamber {
    pub system: GasSystem,
    pub intake_runner: GasSystem,
    /// The exhaust runner + header primary. Its pressure and dynamic pressure
    /// are the raw audio excitation.
    pub exhaust_runner: GasSystem,

    flame: FlameEvent,
    pub lit: bool,

    manifold_to_runner_flow_rate: f64,
    primary_to_collector_flow_rate: f64,
    cylinder_cross_section_area: f64,

    intake_flow_rate: f64,
    exhaust_flow_rate: f64,
    pub exhaust_valve_lift: f64,
    pub intake_valve_lift: f64,

    pub volume: f64,
    pub piston_speed: f64,

    pressure_samples: Vec<f64>,
    piston_speed_samples: Vec<f64>,

    pub last_timestep_exhaust_flow: f64,
    pub last_timestep_intake_flow: f64,
}

impl Chamber {
    fn new(
        cfg: &EngineConfig,
        intake: &Intake,
        exhaust: &Exhaust,
        cylinder: &CylinderConfig,
    ) -> Self {
        let bore_r = cfg.bore / 2.0;
        let cylinder_cross_section_area = PI * bore_r * bore_r;

        let mut system = GasSystem::default();
        // Volume is set on the first update; start at the chamber volume.
        system.initialize(ATM, cfg.chamber_volume.max(1e-9), celsius(25.0));
        system.set_geometry(
            cylinder_cross_section_area.sqrt(),
            cfg.chamber_volume / cylinder_cross_section_area,
            1.0,
            0.0,
        );

        let intake_runner_cross_section = cfg.intake_runner_cross_section_area;
        let manifold_runner_volume = intake_runner_cross_section * intake.runner_length();
        let total_intake_runner_volume = cfg.intake_runner_volume + manifold_runner_volume;
        let overall_intake_runner_length = total_intake_runner_volume / intake_runner_cross_section;
        let mut intake_runner = GasSystem::default();
        intake_runner.initialize(ATM, total_intake_runner_volume, celsius(25.0));
        intake_runner.set_geometry(
            overall_intake_runner_length,
            intake_runner_cross_section.sqrt(),
            1.0,
            0.0,
        );

        let exhaust_runner_cross_section = cfg.exhaust_runner_cross_section_area;
        let exhaust_tube_length = exhaust.primary_tube_length() + cylinder.header_primary_length;
        let exhaust_tube_volume = exhaust_runner_cross_section * exhaust_tube_length;
        let total_exhaust_runner_volume = cfg.exhaust_runner_volume + exhaust_tube_volume;
        let overall_exhaust_runner_length =
            total_exhaust_runner_volume / exhaust_runner_cross_section;
        let mut exhaust_runner = GasSystem::default();
        exhaust_runner.initialize(ATM, total_exhaust_runner_volume, celsius(25.0));
        exhaust_runner.set_geometry(
            overall_exhaust_runner_length,
            exhaust_runner_cross_section.sqrt(),
            1.0,
            0.0,
        );

        Self {
            system,
            intake_runner,
            exhaust_runner,
            flame: FlameEvent::default(),
            lit: false,
            manifold_to_runner_flow_rate: intake.runner_flow_rate(),
            primary_to_collector_flow_rate: exhaust.primary_flow_rate(),
            cylinder_cross_section_area,
            intake_flow_rate: 0.0,
            exhaust_flow_rate: 0.0,
            exhaust_valve_lift: 0.0,
            intake_valve_lift: 0.0,
            volume: cfg.chamber_volume,
            piston_speed: 0.0,
            pressure_samples: vec![0.0; STATE_SAMPLES],
            piston_speed_samples: vec![0.0; STATE_SAMPLES],
            last_timestep_exhaust_flow: 0.0,
            last_timestep_intake_flow: 0.0,
        }
    }

    fn mean_piston_speed(&self) -> f64 {
        self.piston_speed_samples.iter().sum::<f64>() / STATE_SAMPLES as f64
    }

    /// Highest cylinder pressure seen over the last complete cycle. The
    /// original feeds this to the flame speed model (which currently ignores
    /// it); exposed here because it is the one genuinely interesting number the
    /// combustion model produces.
    pub fn peak_cylinder_pressure(&self) -> f64 {
        self.pressure_samples.iter().copied().fold(0.0, f64::max)
    }

    /// Port of `CombustionChamber::ignite`.
    fn ignite(&mut self, cfg: &EngineConfig, rng: &mut Rng) {
        if self.lit {
            return;
        }
        if self.system.mix.p_fuel == 0.0 {
            return;
        }

        let fuel = &cfg.fuel;
        let afr = self.system.mix.p_o2 / self.system.mix.p_fuel;
        let equivalence_ratio = afr / fuel.molecular_afr;
        if !(0.5..=1.9).contains(&equivalence_ratio) {
            return;
        }

        let ideal_inert = self.system.mix.p_o2 / 0.7;
        let dilution = (self.system.mix.p_inert / ideal_inert) - 1.0;

        self.flame.last_volume = self.volume;
        self.flame.travel_x = 0.0;
        self.flame.travel_y = 0.0;
        self.flame.global_mix = self.system.mix;
        self.lit = true;

        let turbulence = mean_piston_speed_to_turbulence(self.mean_piston_speed());
        let mixing_factor = 1.0
            - (clamp01(turbulence / fuel.max_turbulence_effect)
                * clamp01(1.0 - dilution / fuel.max_dilution_effect));
        let rand_s = fuel.low_efficiency_attenuation
            * ((1.0 - fuel.burning_efficiency_randomness)
                + fuel.burning_efficiency_randomness * rng.unit() as f64);
        let efficiency_attenuation = mixing_factor * rand_s + (1.0 - mixing_factor);

        self.flame.efficiency = efficiency_attenuation * fuel.max_burning_efficiency;
        self.flame.flame_speed = flame_speed(
            cfg,
            turbulence,
            afr,
            self.system.temperature(),
            self.system.pressure(),
        );
    }

    /// Port of `CombustionChamber::update`.
    fn update(&mut self, cfg: &EngineConfig, volume: f64, piston_speed: f64, cycle_angle: f64) {
        self.volume = volume;
        self.piston_speed = piston_speed;
        self.system.set_volume(volume);

        let idx = ((cycle_angle / (4.0 * PI)) * (STATE_SAMPLES as f64 - 1.0)).round();
        let idx = if idx.is_finite() {
            (idx as usize).min(STATE_SAMPLES - 1)
        } else {
            0
        };
        self.piston_speed_samples[idx] = piston_speed.abs();
        self.pressure_samples[idx] = self.system.pressure();

        self.intake_flow_rate = cfg.intake_port_flow.sample_triangle(self.intake_valve_lift);
        self.exhaust_flow_rate = cfg
            .exhaust_port_flow
            .sample_triangle(self.exhaust_valve_lift);
    }
}

fn mean_piston_speed_to_turbulence(mean_piston_speed: f64) -> f64 {
    // The original builds `Function{(i, i*0.5) for i in 0..30}`, which is just
    // a clamped half-scale ramp.
    clamp(mean_piston_speed, 0.0, 29.0) * 0.5
}

/// Port of `Fuel::flameSpeed` / `Fuel::laminarBurningVelocity`.
fn flame_speed(cfg: &EngineConfig, turbulence: f64, molecular_afr: f64, t: f64, p: f64) -> f64 {
    const ER_M: f64 = 1.21;
    let b_m = 30.5 * CM / SEC;
    let b_er = -54.9 * CM / SEC;

    let er = molecular_afr / cfg.fuel.molecular_afr;
    let alpha = 2.4 - 0.271 * er.powf(3.51);
    let beta = -0.357 + 0.14 * er.powf(2.77);

    let s_l_0 = b_m + b_er * (er - ER_M) * (er - ER_M);
    let t_ratio = t / 298.0;
    let p_ratio = p / ATM;

    let s_l = s_l_0 * t_ratio.powf(alpha) * p_ratio.powf(beta);
    if !s_l.is_finite() || s_l <= 0.0 {
        return 0.0;
    }

    cfg.fuel
        .turbulence_to_flame_speed_ratio
        .sample_triangle(turbulence / s_l)
        * s_l
}

/// Port of `CombustionChamber::flow`. Runs one fluid sub-step for one cylinder.
#[allow(clippy::too_many_arguments)]
fn chamber_flow(
    chamber: &mut Chamber,
    cfg: &EngineConfig,
    intake: &mut Intake,
    exhaust: &mut Exhaust,
    dt: f64,
) {
    let volume = chamber.volume;
    let cylinder_height = volume / chamber.cylinder_cross_section_area;
    let cylinder_surface_area =
        cylinder_height * PI * cfg.bore + chamber.cylinder_cross_section_area * 2.0;

    // Heat loss to the (90 °C) cylinder walls.
    let d_t = celsius(90.0) - chamber.system.temperature();
    chamber
        .system
        .change_energy(d_t * cylinder_surface_area * 100.0 * dt);

    // Blowby past the rings.
    chamber.system.flow_env(
        cfg.blowby_k,
        dt,
        cfg.crankcase_pressure,
        celsius(25.0),
        Mix::default(),
    );

    let mut params = FlowParameters {
        k_flow: 0.0,
        dt,
        direction_x: 1.0,
        direction_y: 0.0,
        cross_section_area_0: 0.0,
        cross_section_area_1: 0.0,
    };

    // Plenum -> intake runner
    params.k_flow = chamber.manifold_to_runner_flow_rate;
    params.cross_section_area_0 = intake.plenum_cross_section_area();
    params.cross_section_area_1 = cfg.intake_runner_cross_section_area;
    flow(&params, &mut intake.system, &mut chamber.intake_runner);
    chamber.intake_runner.dissipate_excess_velocity();

    // Intake runner -> cylinder
    params.k_flow = chamber.intake_flow_rate;
    params.cross_section_area_0 = cfg.intake_runner_cross_section_area;
    params.cross_section_area_1 = volume / cylinder_height;
    let intake_flow = {
        let Chamber {
            intake_runner,
            system,
            ..
        } = chamber;
        flow(&params, intake_runner, system)
    };
    chamber.intake_runner.dissipate_excess_velocity();
    chamber.system.dissipate_excess_velocity();

    // Cylinder -> exhaust runner
    params.k_flow = chamber.exhaust_flow_rate;
    params.cross_section_area_0 = volume / cylinder_height;
    params.cross_section_area_1 = cfg.exhaust_runner_cross_section_area;
    let exhaust_flow = {
        let Chamber {
            system,
            exhaust_runner,
            ..
        } = chamber;
        flow(&params, system, exhaust_runner)
    };
    chamber.system.dissipate_excess_velocity();
    chamber.exhaust_runner.dissipate_excess_velocity();

    // Exhaust runner -> collector
    params.k_flow = chamber.primary_to_collector_flow_rate;
    params.cross_section_area_0 = cfg.exhaust_runner_cross_section_area;
    params.cross_section_area_1 = exhaust.collector_cross_section_area();
    flow(&params, &mut chamber.exhaust_runner, &mut exhaust.system);

    chamber
        .intake_runner
        .update_velocity(dt, intake.cfg.velocity_decay);
    chamber.system.update_velocity(dt, 0.5);
    chamber
        .exhaust_runner
        .update_velocity(dt, exhaust.cfg.velocity_decay);

    // Any intake flow quenches the flame.
    if intake_flow.abs() > 1e-9 && chamber.lit {
        chamber.lit = false;
    }

    chamber.last_timestep_exhaust_flow += exhaust_flow;
    chamber.last_timestep_intake_flow += intake_flow;

    // Flame propagation.
    if chamber.lit {
        let total_travel_x = cfg.bore / 2.0;
        let total_travel_y = volume / gas::bore_surface_area(cfg.bore);
        let expansion = volume / chamber.flame.last_volume;
        let last_travel_x = chamber.flame.travel_x;
        let last_travel_y = chamber.flame.travel_y * expansion;
        let flame_speed = chamber.flame.flame_speed;

        chamber.flame.travel_x = (last_travel_x + dt * flame_speed).min(total_travel_x);
        chamber.flame.travel_y = (last_travel_y + dt * flame_speed).min(total_travel_y);

        if last_travel_x < chamber.flame.travel_x || last_travel_y < chamber.flame.travel_y {
            let burned_volume =
                chamber.flame.travel_x * chamber.flame.travel_x * PI * chamber.flame.travel_y;
            let prev_burned_volume = last_travel_x * last_travel_x * PI * last_travel_y;
            let lit_volume = burned_volume - prev_burned_volume;
            let n = (lit_volume / volume) * chamber.system.n();

            let global_mix = chamber.flame.global_mix;
            let fuel_burned = chamber
                .system
                .react(n * chamber.flame.efficiency, global_mix);
            let mass_fuel_burned = fuel_burned * cfg.fuel.molecular_mass;
            chamber
                .system
                .change_energy(mass_fuel_burned * cfg.fuel.energy_density);
        } else {
            chamber.lit = false;
        }

        chamber.flame.last_volume = volume;
    }
}

// ---------------------------------------------------------------------------
// Ignition
// ---------------------------------------------------------------------------

pub struct IgnitionModule {
    plugs: Vec<f64>,
    events: Vec<bool>,
    pub enabled: bool,
    last_crankshaft_angle: f64,
    rev_limit_timer: f64,
}

impl IgnitionModule {
    fn new(cfg: &EngineConfig) -> Self {
        Self {
            plugs: cfg.cylinders.iter().map(|c| c.ignition_angle).collect(),
            events: vec![false; cfg.cylinders.len()],
            enabled: true,
            last_crankshaft_angle: 0.0,
            rev_limit_timer: 0.0,
        }
    }

    fn reset(&mut self, cycle_angle: f64) {
        self.last_crankshaft_angle = cycle_angle;
        self.events.iter_mut().for_each(|e| *e = false);
    }

    fn timing_advance(&self, cfg: &EngineConfig, omega: f64) -> f64 {
        cfg.timing_curve.sample_triangle(-omega)
    }

    /// Port of `IgnitionModule::update`.
    ///
    /// The crossing test is rewritten to work on the unwrapped angular delta.
    /// The original compares against a wrapped interval and, on the single step
    /// per cycle where the angle wraps, can drop a spark whose plug angle sits
    /// just below the wrap point. Same behaviour everywhere else.
    fn update(&mut self, cfg: &EngineConfig, dt: f64, cycle_angle: f64, omega: f64) {
        let cycle = 4.0 * PI;

        if self.enabled && self.rev_limit_timer == 0.0 {
            let advance = self.timing_advance(cfg, omega);
            let forward = omega < 0.0;

            let travelled = if forward {
                positive_mod(cycle_angle - self.last_crankshaft_angle, cycle)
            } else {
                positive_mod(self.last_crankshaft_angle - cycle_angle, cycle)
            };

            // A single step should never cover a whole cycle; if it does the
            // simulation rate is far too low to resolve individual events.
            if travelled < cycle {
                for (i, &plug_angle) in self.plugs.iter().enumerate() {
                    let adjusted = positive_mod(plug_angle - advance, cycle);
                    let distance = if forward {
                        positive_mod(adjusted - self.last_crankshaft_angle, cycle)
                    } else {
                        positive_mod(self.last_crankshaft_angle - adjusted, cycle)
                    };

                    if distance < travelled {
                        self.events[i] = true;
                    }
                }
            }
        }

        self.rev_limit_timer -= dt;
        if omega.abs() > cfg.rev_limit {
            self.rev_limit_timer = cfg.limiter_duration;
        }
        if self.rev_limit_timer < 0.0 {
            self.rev_limit_timer = 0.0;
        }

        self.last_crankshaft_angle = cycle_angle;
    }

    fn reset_events(&mut self) {
        self.events.iter_mut().for_each(|e| *e = false);
    }

    pub fn is_limiting(&self) -> bool {
        self.rev_limit_timer > 0.0
    }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/// Friction model for one piston. Port of
/// `CombustionChamber::calculateFrictionForce`.
struct FrictionModel {
    friction_coeff: f64,
    breakaway_friction: f64,
    breakaway_friction_velocity: f64,
    viscous_friction_coefficient: f64,
}

impl Default for FrictionModel {
    fn default() -> Self {
        Self {
            friction_coeff: 0.06,
            breakaway_friction: 50.0 * N,
            breakaway_friction_velocity: 0.1 * M,
            viscous_friction_coefficient: 20.0 * N,
        }
    }
}

impl FrictionModel {
    fn force(&self, v_s: f64, cylinder_wall_force: f64) -> f64 {
        let f_coul = self.friction_coeff * cylinder_wall_force;
        let v_st = self.breakaway_friction_velocity * ROOT_2;
        let v_coul = self.breakaway_friction_velocity / 10.0;
        let f_brk = self.breakaway_friction;
        let v = v_s.abs();

        let f_0 = ROOT_2 * E * (f_brk - f_coul);
        let f_1 = v / v_st;
        let f_2 = (-f_1 * f_1).exp() * f_1;
        let f_3 = f_coul * (v / v_coul).tanh();
        let f_4 = self.viscous_friction_coefficient * v;

        f_0 * f_2 + f_3 + f_4
    }
}

pub struct Engine {
    pub cfg: EngineConfig,
    pub intakes: Vec<Intake>,
    pub exhausts: Vec<Exhaust>,
    pub chambers: Vec<Chamber>,
    pub ignition: IgnitionModule,

    /// Crank angle (rad). Decreases as the engine turns over.
    pub theta: f64,
    /// Crank angular velocity (rad/s); negative when running.
    pub omega: f64,

    /// Bank axis angle per cylinder, precomputed.
    axis_angles: Vec<f64>,

    friction: FrictionModel,
    rng: Rng,

    /// Speed control, 0..1.
    pub speed_control: f64,
    starter_enabled: bool,
    /// How long the starter has been engaged this attempt, seconds.
    starter_elapsed: f64,
    /// External braking torque, N·m, always opposing rotation.
    pub load_torque: f64,
    /// Selected gear, or `None` for neutral.
    gear: Option<usize>,
    /// The car's own speed, m/s. It has to be state of its own: without it the
    /// engine could not pull away from rest, and a gearchange would move the
    /// car instead of dropping the revs.
    road_speed: f64,

    pub filtered_engine_speed: f64,
}

impl Engine {
    pub fn new(cfg: EngineConfig) -> Self {
        let intakes: Vec<Intake> = cfg.intakes.iter().map(Intake::new).collect();
        let exhausts: Vec<Exhaust> = cfg.exhausts.iter().map(Exhaust::new).collect();

        let chambers: Vec<Chamber> = cfg
            .cylinders
            .iter()
            .map(|c| {
                Chamber::new(
                    &cfg,
                    &intakes[c.intake.min(intakes.len() - 1)],
                    &exhausts[c.exhaust.min(exhausts.len() - 1)],
                    c,
                )
            })
            .collect();

        let axis_angles = cfg
            .cylinders
            .iter()
            .map(|c| cfg.banks[c.bank].angle + PI / 2.0)
            .collect();

        let ignition = IgnitionModule::new(&cfg);

        let mut engine = Self {
            cfg,
            intakes,
            exhausts,
            chambers,
            ignition,
            theta: 0.0,
            omega: 0.0,
            axis_angles,
            friction: FrictionModel::default(),
            rng: Rng::new(0x1234_5678),
            speed_control: 0.0,
            starter_enabled: false,
            starter_elapsed: 0.0,
            load_torque: 0.0,
            gear: None,
            road_speed: 0.0,
            filtered_engine_speed: 0.0,
        };

        // Place the pistons and size each chamber accordingly.
        for i in 0..engine.chambers.len() {
            let volume = engine.cylinder_volume(i);
            engine.chambers[i]
                .system
                .initialize(ATM, volume, celsius(25.0));
            engine.chambers[i].volume = volume;
        }

        let cycle_angle = engine.cycle_angle();
        engine.ignition.reset(cycle_angle);
        engine.apply_throttle();
        engine
    }

    pub fn cylinder_count(&self) -> usize {
        self.chambers.len()
    }

    #[inline]
    pub fn crank_angle(&self) -> f64 {
        self.theta - self.cfg.tdc
    }

    #[inline]
    pub fn cycle_angle(&self) -> f64 {
        positive_mod(-self.crank_angle(), 4.0 * PI)
    }

    #[inline]
    pub fn cam_angle(&self) -> f64 {
        positive_mod((self.crank_angle() + self.cfg.cam_advance) * 0.5, 2.0 * PI)
    }

    #[inline]
    pub fn rpm(&self) -> f64 {
        to_rpm(self.omega).abs()
    }

    /// Forces the crank to a speed.
    ///
    /// This sets the speed, it does not hold it: combustion and friction take
    /// over from the next step, so a caller driving rpm directly should call
    /// this every block.
    ///
    /// In gear the car is moved to match. Teleporting the crank while leaving
    /// the car where it was would open up a whole gearbox of slip for the
    /// clutch to slam shut, which sounds like a dropped clutch because that is
    /// exactly what it is. Select neutral first to rev against nothing.
    pub fn set_rpm(&mut self, rpm_value: f64) {
        self.omega = -rpm(rpm_value.abs());
        if let Some(speed) = self.cfg.vehicle.speed_for(self.omega, self.gear) {
            self.road_speed = speed;
        }
    }

    #[inline]
    fn kinematics(&self, cylinder: usize) -> PistonKinematics {
        piston_kinematics(
            self.theta,
            self.cfg.cylinders[cylinder].journal_angle,
            self.axis_angles[cylinder],
            self.cfg.crank_throw,
            self.cfg.rod_length,
        )
    }

    fn cylinder_volume(&self, cylinder: usize) -> f64 {
        let k = self.kinematics(cylinder);
        let area = gas::bore_surface_area(self.cfg.bore);
        let sweep = area * (self.cfg.deck_height - k.s - self.cfg.compression_height);
        (sweep + self.cfg.chamber_volume - self.cfg.piston_displacement).max(1e-9)
    }

    /// Samples the cam lobes. Port of `Camshaft::valveLift` / `sampleLobe`.
    fn valve_lifts(&self, cylinder: usize) -> (f64, f64) {
        let cam = self.cam_angle();
        let intake = sample_lobe(
            &self.cfg.intake_lobe_profile,
            cam + self.cfg.intake_lobe_angle(cylinder),
        );
        let exhaust = sample_lobe(
            &self.cfg.exhaust_lobe_profile,
            cam + self.cfg.exhaust_lobe_angle(cylinder),
        );
        (intake, exhaust)
    }

    /// Engages or releases the starter. Engaging restarts the timeout, so a
    /// second press while already cranking buys another attempt.
    pub fn set_starter(&mut self, enabled: bool) {
        self.starter_enabled = enabled;
        self.starter_elapsed = 0.0;
    }

    /// Whether the starter is currently turning the engine. Goes false by
    /// itself once the engine catches, or when the attempt times out.
    pub fn starter_engaged(&self) -> bool {
        self.starter_enabled
    }

    /// Selects a gear, or `None` for neutral. Out-of-range gears are neutral.
    pub fn set_gear(&mut self, gear: Option<usize>) {
        self.gear = match gear {
            Some(g) if self.cfg.vehicle.total_ratio(g).is_some() => Some(g),
            _ => None,
        };
    }

    pub fn gear(&self) -> Option<usize> {
        self.gear
    }

    /// Road speed, m/s.
    pub fn road_speed(&self) -> f64 {
        self.road_speed
    }

    /// Puts the car back at a standstill.
    pub fn reset_road_speed(&mut self) {
        self.road_speed = 0.0;
    }

    pub fn set_speed_control(&mut self, s: f64) {
        self.speed_control = clamp01(s);
        self.apply_throttle();
    }

    fn apply_throttle(&mut self) {
        let position = 1.0 - self.speed_control.powf(self.cfg.throttle_gamma);
        for intake in self.intakes.iter_mut() {
            intake.throttle = position;
        }
    }

    /// Net torque on the crank from cylinder pressure and piston friction.
    fn crank_torque(&self) -> f64 {
        let area = gas::bore_surface_area(self.cfg.bore);
        let mut torque = 0.0;

        for i in 0..self.chambers.len() {
            let k = self.kinematics(i);
            let pressure_differential =
                self.chambers[i].system.pressure() - self.cfg.crankcase_pressure;
            let f_gas = -area * pressure_differential;
            torque += f_gas * k.ds_dtheta;

            // Rod angularity presses the piston into the bore; that normal
            // force is what the coulomb term scales with.
            let perpendicular = k.offset.abs();
            let along = (self.cfg.rod_length * self.cfg.rod_length - perpendicular * perpendicular)
                .max(1e-12)
                .sqrt();
            let wall_force = f_gas.abs() * (perpendicular / along);

            let v_s = k.ds_dtheta * self.omega;
            let f_friction = self.friction.force(v_s, wall_force);

            // Always opposes piston motion.
            torque -= f_friction * k.ds_dtheta.abs() * sign(self.omega);
        }

        torque
    }

    /// Advances the crank one timestep.
    fn integrate_crank(&mut self, dt: f64) {
        let inertia = self.cfg.moment_of_inertia.max(1e-6);
        let mut torque = self.crank_torque();

        // Starter drives the crank negative up to its free speed, then drops
        // out once the engine is clearly running under its own power. Real
        // starters disengage through a one-way clutch; without this the caller
        // has to watch the tachometer and guess when to let go of the key.
        //
        // It also gives up after `starter_timeout`, which is the other half of
        // turning a key: you let go. Without that, an engine that cannot catch
        // — held down by load, or with the ignition cut — cranks at starter
        // speed forever, which is both unphysical and impossible to tell apart
        // from a control that did nothing.
        if self.starter_enabled {
            self.starter_elapsed += dt;

            if self.omega.abs() > self.cfg.starter_release_speed
                || self.starter_elapsed > self.cfg.starter_timeout
            {
                self.starter_enabled = false;
                self.starter_elapsed = 0.0;
            } else if self.omega > -self.cfg.starter_speed {
                torque -= self.cfg.starter_torque;
            }
        }

        // Windage / oil / accessory drag, and any external load. Both oppose
        // rotation.
        let windage = self.cfg.windage_coefficient * self.omega * self.omega;
        torque -= sign(self.omega) * (self.load_torque.abs() + windage);

        // The clutch. The crank turns negative when the engine runs, so a
        // positive clutch torque — engine driving the car — slows it, and a
        // negative one is the car driving the engine on a closed throttle.
        let engine_speed = -self.omega;
        let clutch = self
            .cfg
            .vehicle
            .clutch_torque(engine_speed, self.road_speed, self.gear);
        torque += clutch;
        self.road_speed = self
            .cfg
            .vehicle
            .step(self.road_speed, clutch, self.gear, dt);

        self.omega += torque / inertia * dt;

        // Crankshaft bearing friction: bounded, and cannot reverse the crank.
        let dv = self.cfg.friction_torque / inertia * dt;
        if self.omega.abs() <= dv && torque.abs() < self.cfg.friction_torque {
            self.omega = 0.0;
        } else {
            self.omega -= sign(self.omega) * dv;
        }

        self.theta += self.omega * dt;
        self.theta %= 4.0 * PI;

        let alpha = dt / (100.0 + dt);
        self.filtered_engine_speed =
            alpha * self.filtered_engine_speed + (1.0 - alpha) * self.rpm();
    }

    /// One full simulation step. Mirrors `Simulator::simulateStep` +
    /// `PistonEngineSimulator::simulateStep_`.
    pub fn step(&mut self, dt: f64) {
        self.integrate_crank(dt);

        let cycle_angle = self.cycle_angle();
        self.ignition.update(&self.cfg, dt, cycle_angle, self.omega);

        for i in 0..self.chambers.len() {
            if self.ignition.events[i] {
                let cfg = &self.cfg;
                let rng = &mut self.rng;
                self.chambers[i].ignite(cfg, rng);
            }

            let (intake_lift, exhaust_lift) = self.valve_lifts(i);
            let k = self.kinematics(i);
            let volume = self.cylinder_volume(i);
            let piston_speed = k.ds_dtheta * self.omega;

            let chamber = &mut self.chambers[i];
            chamber.intake_valve_lift = intake_lift;
            chamber.exhaust_valve_lift = exhaust_lift;
            chamber.update(&self.cfg, volume, piston_speed, cycle_angle);
        }

        for chamber in self.chambers.iter_mut() {
            chamber.last_timestep_exhaust_flow = 0.0;
            chamber.last_timestep_intake_flow = 0.0;
        }

        let fluid_dt = dt / self.cfg.fluid_simulation_steps as f64;
        for _ in 0..self.cfg.fluid_simulation_steps {
            for exhaust in self.exhausts.iter_mut() {
                exhaust.process(fluid_dt);
            }
            for intake in self.intakes.iter_mut() {
                intake.process(fluid_dt);
                intake.flow_rate += intake.flow;
            }
            for i in 0..self.chambers.len() {
                let intake_index = self.cfg.cylinders[i].intake.min(self.intakes.len() - 1);
                let exhaust_index = self.cfg.cylinders[i].exhaust.min(self.exhausts.len() - 1);

                let chamber = &mut self.chambers[i];
                let intake = &mut self.intakes[intake_index];
                let exhaust = &mut self.exhausts[exhaust_index];

                chamber_flow(chamber, &self.cfg, intake, exhaust, fluid_dt);
            }
        }

        self.ignition.reset_events();
    }

    /// Manifold absolute pressure, Pa. Useful for driving visuals.
    pub fn manifold_pressure(&self) -> f64 {
        if self.intakes.is_empty() {
            return ATM;
        }
        self.intakes
            .iter()
            .map(|i| i.system.pressure())
            .sum::<f64>()
            / self.intakes.len() as f64
    }
}

fn sample_lobe(profile: &crate::function::Function, theta: f64) -> f64 {
    let mut t = theta % (2.0 * PI);
    if t < 0.0 {
        t += 2.0 * PI;
    }
    if t >= PI {
        t -= 2.0 * PI;
    }
    profile.sample_triangle(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Preset;

    #[test]
    fn kinematics_hit_tdc_and_bdc() {
        let throw = 0.045;
        let rod = 0.16;
        let tdc = piston_kinematics(0.0, 0.0, 0.0, throw, rod);
        let bdc = piston_kinematics(PI, 0.0, 0.0, throw, rod);
        assert!((tdc.s - (throw + rod)).abs() < 1e-12);
        assert!((bdc.s - (rod - throw)).abs() < 1e-12);
        assert!((tdc.s - bdc.s - 2.0 * throw).abs() < 1e-12);
        // Lever arm vanishes at both dead centres.
        assert!(tdc.ds_dtheta.abs() < 1e-12);
        assert!(bdc.ds_dtheta.abs() < 1e-12);
    }

    #[test]
    fn ds_dtheta_matches_numeric_derivative() {
        let throw = 0.045;
        let rod = 0.16;
        for i in 0..64 {
            let theta = i as f64 * 0.1;
            let h = 1e-6;
            let a = piston_kinematics(theta - h, 0.3, 0.7, throw, rod).s;
            let b = piston_kinematics(theta + h, 0.3, 0.7, throw, rod).s;
            let numeric = (b - a) / (2.0 * h);
            let analytic = piston_kinematics(theta, 0.3, 0.7, throw, rod).ds_dtheta;
            assert!(
                (numeric - analytic).abs() < 1e-5,
                "theta {theta}: {numeric} vs {analytic}"
            );
        }
    }

    #[test]
    fn cylinder_volume_spans_the_swept_volume() {
        let engine = Engine::new(Preset::Inline4.config());
        let mut min = f64::MAX;
        let mut max: f64 = 0.0;
        let mut e = engine;
        for i in 0..720 {
            e.theta = i as f64 * DEG;
            let v = e.cylinder_volume(0);
            min = min.min(v);
            max = max.max(v);
        }
        let swept = gas::bore_surface_area(e.cfg.bore) * (2.0 * e.cfg.crank_throw);
        assert!((min - e.cfg.chamber_volume).abs() / e.cfg.chamber_volume < 1e-6);
        assert!((max - min - swept).abs() / swept < 1e-6);
    }

    #[test]
    fn exhaust_valve_opens_late_in_the_power_stroke() {
        // For cylinder 0, the exhaust valve should be shut around compression
        // TDC and open near the end of the power stroke.
        let mut e = Engine::new(Preset::Inline4.config());
        let fire = e.cfg.cylinders[0].ignition_angle;

        let set_cycle = |e: &mut Engine, cycle: f64| {
            e.theta = e.cfg.tdc - cycle;
        };

        set_cycle(&mut e, fire);
        let (_, exhaust_at_tdc) = e.valve_lifts(0);

        set_cycle(&mut e, fire + 160.0 * DEG);
        let (_, exhaust_late_power) = e.valve_lifts(0);

        assert!(exhaust_at_tdc < 1e-4, "exhaust open at firing TDC");
        assert!(
            exhaust_late_power > 1e-3,
            "exhaust shut at end of power stroke: {exhaust_late_power}"
        );
    }

    #[test]
    fn intake_valve_opens_on_the_intake_stroke() {
        let mut e = Engine::new(Preset::Inline4.config());
        let fire = e.cfg.cylinders[0].ignition_angle;
        // Intake stroke starts ~360° after the power stroke begins.
        e.theta = e.cfg.tdc - (fire + 450.0 * DEG);
        let (intake_lift, _) = e.valve_lifts(0);
        assert!(intake_lift > 1e-3, "intake shut mid intake stroke");
    }
}
