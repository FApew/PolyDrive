//! Engine description: geometry, valvetrain, flow paths, firing order.
//!
//! Corresponds to what the original expresses in its `.mr` script files, minus
//! everything that only exists to draw the engine on screen.

use crate::drivetrain::VehicleConfig;
use crate::function::{harmonic_cam_lobe, Function};
use crate::gas::{k_28in_h2o, k_carb};
use crate::synth::AudioParameters;
use crate::units::*;

#[derive(Clone, Debug)]
pub struct FuelConfig {
    pub molecular_mass: f64,
    pub energy_density: f64,
    pub molecular_afr: f64,
    pub burning_efficiency_randomness: f64,
    pub low_efficiency_attenuation: f64,
    pub max_burning_efficiency: f64,
    pub max_turbulence_effect: f64,
    pub max_dilution_effect: f64,
    pub turbulence_to_flame_speed_ratio: Function,
}

impl Default for FuelConfig {
    fn default() -> Self {
        Self {
            molecular_mass: 100.0 * G,
            energy_density: 48.1 * KJ / G,
            molecular_afr: 25.0 / 2.0,
            burning_efficiency_randomness: 0.5,
            low_efficiency_attenuation: 0.6,
            max_burning_efficiency: 1.0,
            max_turbulence_effect: 2.0,
            max_dilution_effect: 50.0,
            turbulence_to_flame_speed_ratio: Function::from_samples(
                5.0,
                &[
                    (0.0, 3.0),
                    (5.0, 1.5 * 5.0),
                    (10.0, 1.75 * 10.0),
                    (15.0, 2.0 * 15.0),
                    (20.0, 2.0 * 20.0),
                    (25.0, 2.0 * 25.0),
                    (30.0, 2.0 * 30.0),
                    (35.0, 2.0 * 35.0),
                    (40.0, 2.0 * 40.0),
                    (45.0, 2.0 * 45.0),
                ],
            ),
        }
    }
}

#[derive(Clone, Debug)]
pub struct IntakeConfig {
    pub plenum_volume: f64,
    pub plenum_cross_section_area: f64,
    pub input_flow_k: f64,
    pub idle_flow_k: f64,
    pub runner_flow_rate: f64,
    pub runner_length: f64,
    pub molecular_afr: f64,
    pub idle_throttle_plate_position: f64,
    pub velocity_decay: f64,
}

impl Default for IntakeConfig {
    fn default() -> Self {
        Self {
            plenum_volume: 1.325 * L,
            plenum_cross_section_area: 20.0 * CM2,
            input_flow_k: k_carb(700.0),
            idle_flow_k: k_carb(0.0),
            runner_flow_rate: k_carb(100.0),
            runner_length: 12.0 * INCH,
            molecular_afr: 25.0 / 2.0,
            idle_throttle_plate_position: 0.975,
            velocity_decay: 0.5,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ExhaustConfig {
    /// Collector length (also sets the acoustic delay for its cylinders).
    pub length: f64,
    pub collector_cross_section_area: f64,
    pub outlet_flow_rate: f64,
    pub primary_tube_length: f64,
    pub primary_flow_rate: f64,
    pub velocity_decay: f64,
    pub audio_volume: f64,
}

impl Default for ExhaustConfig {
    fn default() -> Self {
        Self {
            length: 100.0 * INCH,
            collector_cross_section_area: 20.0 * CM2,
            outlet_flow_rate: k_carb(1000.0),
            primary_tube_length: 29.0 * INCH,
            primary_flow_rate: k_carb(600.0),
            velocity_decay: 0.5,
            audio_volume: 0.2,
        }
    }
}

#[derive(Clone, Debug)]
pub struct BankConfig {
    /// Bank angle from vertical, radians.
    pub angle: f64,
}

#[derive(Clone, Debug)]
pub struct CylinderConfig {
    pub bank: usize,
    /// Rod journal angle on the crank, radians.
    pub journal_angle: f64,
    pub exhaust: usize,
    pub intake: usize,
    /// Per-cylinder mix level. Small variations here are a large part of why
    /// real engines do not sound like a metronome.
    pub sound_attenuation: f64,
    pub header_primary_length: f64,
    /// Cycle angle (0..4π) at which this cylinder reaches compression TDC.
    /// Derived from the firing order by [`EngineConfig::resolve_firing_order`].
    pub ignition_angle: f64,
}

#[derive(Clone, Debug)]
pub struct EngineConfig {
    pub name: String,

    pub simulation_frequency: f64,
    pub fluid_simulation_steps: usize,

    // Rotating assembly
    pub crank_throw: f64,
    pub moment_of_inertia: f64,
    /// Speed-independent bearing/seal drag, N·m.
    pub friction_torque: f64,
    /// Windage, oil pumping and accessory drag: `torque = c * omega^2`.
    ///
    /// The original leaves this out because its dynamometer and vehicle model
    /// supply the load. With those removed, a purely constant friction torque
    /// lets an unloaded engine coast down implausibly slowly, so the
    /// speed-dependent part of the real loss is modelled here instead.
    pub windage_coefficient: f64,
    /// Crank angle of bank 0's cylinder axis. Cycle angles are measured from
    /// here, matching the original's `tdc` parameter.
    pub tdc: f64,

    // Slider-crank geometry
    pub bore: f64,
    pub rod_length: f64,
    pub compression_height: f64,
    pub piston_displacement: f64,
    pub blowby_k: f64,
    pub chamber_volume: f64,
    /// Distance from crank centreline to deck. Defaults to
    /// `throw + rod_length + compression_height` if left at zero.
    pub deck_height: f64,

    // Head
    pub intake_runner_volume: f64,
    pub intake_runner_cross_section_area: f64,
    pub exhaust_runner_volume: f64,
    pub exhaust_runner_cross_section_area: f64,
    pub intake_port_flow: Function,
    pub exhaust_port_flow: Function,

    // Valvetrain
    pub intake_lobe_profile: Function,
    pub exhaust_lobe_profile: Function,
    pub intake_lobe_center: f64,
    pub exhaust_lobe_center: f64,
    pub cam_advance: f64,

    // Flow paths
    pub intakes: Vec<IntakeConfig>,
    pub exhausts: Vec<ExhaustConfig>,

    // Layout
    pub banks: Vec<BankConfig>,
    pub cylinders: Vec<CylinderConfig>,

    // Ignition
    pub timing_curve: Function,
    pub rev_limit: f64,
    pub limiter_duration: f64,

    pub fuel: FuelConfig,
    pub crankcase_pressure: f64,

    // Cranking
    pub starter_torque: f64,
    pub starter_speed: f64,
    /// Crank speed at which the starter drops out, rad/s.
    pub starter_release_speed: f64,
    /// How long one starter attempt cranks before giving up, seconds. Every
    /// preset here catches within about four seconds, so this only ends
    /// attempts that were never going to succeed.
    pub starter_timeout: f64,

    pub throttle_gamma: f64,

    /// The car the engine is bolted into. Only matters once a gear is
    /// selected; in neutral the engine spins against its own friction.
    pub vehicle: VehicleConfig,

    pub audio: AudioParameters,
}

/// Standard port flow curve, scaled from the Ferrari F136 head in the original
/// asset set. `flow_scale` multiplies flow (SCFM), `lift_scale` multiplies lift.
fn port_flow(samples: &[(f64, f64)], lift_scale: f64, flow_scale: f64) -> Function {
    let mut f = Function::new(50.0 * THOU * lift_scale);
    for &(lift_thou, scfm) in samples {
        f.add_sample(lift_thou * THOU * lift_scale, k_28in_h2o(scfm * flow_scale));
    }
    f
}

const INTAKE_FLOW_TABLE: &[(f64, f64)] = &[
    (0.0, 0.0),
    (50.0, 58.0),
    (100.0, 103.0),
    (150.0, 156.0),
    (200.0, 214.0),
    (250.0, 249.0),
    (300.0, 268.0),
    (350.0, 280.0),
    (400.0, 280.0),
    (450.0, 281.0),
];

const EXHAUST_FLOW_TABLE: &[(f64, f64)] = &[
    (0.0, 0.0),
    (50.0, 37.0),
    (100.0, 72.0),
    (150.0, 113.0),
    (200.0, 160.0),
    (250.0, 196.0),
    (300.0, 222.0),
    (350.0, 235.0),
    (400.0, 245.0),
    (450.0, 246.0),
];

fn default_timing_curve() -> Function {
    let mut f = Function::new(rpm(1000.0));
    for &(r, deg) in &[
        (0.0, 12.0),
        (1000.0, 12.0),
        (2000.0, 20.0),
        (3000.0, 30.0),
        (4000.0, 40.0),
        (5000.0, 40.0),
        (6000.0, 40.0),
        (7000.0, 40.0),
        (8000.0, 40.0),
    ] {
        f.add_sample(rpm(r), deg * DEG);
    }
    f
}

/// Cylinder placement for a preset: which bank, which rod journal.
#[derive(Clone, Copy, Debug)]
pub struct CylinderPlacement {
    pub bank: usize,
    pub journal_angle_deg: f64,
}

/// Everything a preset needs to specify beyond the shared defaults.
#[derive(Clone, Debug)]
pub struct Layout {
    pub name: &'static str,
    /// Bank angles from vertical, degrees.
    pub bank_angles_deg: &'static [f64],
    pub cylinders: &'static [CylinderPlacement],
    /// Cylinder indices in firing order.
    pub firing_order: &'static [usize],
    /// One exhaust system per entry; value is the bank it collects from.
    pub exhaust_banks: &'static [usize],
    pub bore: f64,
    pub stroke: f64,
    pub rod_length: f64,
    pub chamber_volume: f64,
    pub redline_rpm: f64,
    pub cam_duration_deg: f64,
    pub cam_lift_thou: f64,
    pub lobe_center_deg: f64,
    pub moment_of_inertia: f64,
    pub friction_torque: f64,
    /// Throttle plate position at rest, 0..1, where 1 is fully shut. This is
    /// the idle stop screw: `cos(idle_plate * pi/2)` is the fraction of the
    /// throttle body's capacity that still gets through, so small changes here
    /// move idle speed a lot. Motorcycle engines sit further open than car
    /// engines, which is why they idle higher.
    pub idle_plate: f64,
    pub audio: AudioParameters,
    /// Runs after [`EngineConfig::from_layout`] has derived the generic parts.
    ///
    /// The derivation scales flow, runner and plenum sizes off swept volume,
    /// which is a reasonable guess for a generic layout and wrong for any
    /// specific engine. A real engine is defined by exactly the things that
    /// cannot be derived — its head, its carburettor, its exhaust — so those
    /// go here instead of adding a dozen mostly-unused fields to every layout.
    pub refine: Option<fn(&mut EngineConfig)>,
}

impl EngineConfig {
    /// Builds a full configuration from a layout, deriving flow capacities,
    /// runner volumes and plenum size from the swept volume.
    pub fn from_layout(layout: &Layout) -> Self {
        let cylinder_count = layout.cylinders.len();
        let bore = layout.bore;
        let stroke = layout.stroke;
        let compression_height = 1.0 * INCH;

        let displacement_per_cylinder = crate::gas::bore_surface_area(bore) * stroke;
        let total_displacement = displacement_per_cylinder * cylinder_count as f64;

        // Reference engine: 94 mm bore, 81 mm stroke, 8 cylinders.
        let reference_per_cylinder = crate::gas::bore_surface_area(94.0 * MM) * (81.0 * MM);
        let size_scale = displacement_per_cylinder / reference_per_cylinder;
        let lift_scale = (bore / (94.0 * MM)).max(0.25);

        let intake_runner_cross_section = (2.2 * INCH * lift_scale) * (2.2 * INCH * lift_scale);
        let exhaust_runner_cross_section = (1.75 * INCH * lift_scale) * (1.75 * INCH * lift_scale);

        let banks: Vec<BankConfig> = layout
            .bank_angles_deg
            .iter()
            .map(|&a| BankConfig { angle: a * DEG })
            .collect();

        // Per-cylinder flavour: alternating attenuation and staggered primary
        // lengths, as the hand-tuned configurations in the original do.
        let cylinders: Vec<CylinderConfig> = layout
            .cylinders
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let exhaust = layout
                    .exhaust_banks
                    .iter()
                    .position(|&b| b == c.bank)
                    .unwrap_or(0);
                CylinderConfig {
                    bank: c.bank,
                    journal_angle: c.journal_angle_deg * DEG,
                    exhaust,
                    intake: 0,
                    sound_attenuation: 0.8 + 0.1 * ((i * 7) % 5) as f64,
                    header_primary_length: (1.0 + ((i * 3) % 7) as f64) * CM,
                    ignition_angle: 0.0,
                }
            })
            .collect();

        let exhausts: Vec<ExhaustConfig> = layout
            .exhaust_banks
            .iter()
            .map(|_| {
                let cylinders_on_system =
                    (cylinder_count as f64 / layout.exhaust_banks.len() as f64).max(1.0);
                ExhaustConfig {
                    length: 100.0 * INCH,
                    collector_cross_section_area: 20.0 * CM2 * size_scale * cylinders_on_system
                        / 4.0,
                    outlet_flow_rate: k_carb(125.0 * size_scale * cylinders_on_system),
                    primary_tube_length: 29.0 * INCH,
                    primary_flow_rate: k_carb(75.0 * size_scale * cylinders_on_system),
                    velocity_decay: 0.5,
                    audio_volume: 0.2,
                }
            })
            .collect();

        let intake = IntakeConfig {
            plenum_volume: (total_displacement * 0.8).max(0.05 * L),
            plenum_cross_section_area: 20.0 * CM2 * size_scale,
            input_flow_k: k_carb(87.5 * size_scale * cylinder_count as f64),
            idle_flow_k: k_carb(0.0),
            runner_flow_rate: k_carb(12.5 * size_scale * cylinder_count as f64),
            runner_length: 12.0 * INCH,
            idle_throttle_plate_position: layout.idle_plate,
            ..Default::default()
        };

        let mut config = Self {
            name: layout.name.to_string(),

            simulation_frequency: 10000.0,
            fluid_simulation_steps: 8,

            crank_throw: stroke / 2.0,
            moment_of_inertia: layout.moment_of_inertia,
            friction_torque: layout.friction_torque,
            windage_coefficient: 0.030 * total_displacement,
            tdc: banks[0].angle + PI / 2.0,

            bore,
            rod_length: layout.rod_length,
            compression_height,
            piston_displacement: 0.0,
            blowby_k: k_28in_h2o(0.05),
            chamber_volume: layout.chamber_volume,
            deck_height: stroke / 2.0 + layout.rod_length + compression_height,

            intake_runner_volume: 149.6 * CC * size_scale,
            intake_runner_cross_section_area: intake_runner_cross_section,
            exhaust_runner_volume: 50.0 * CC * size_scale,
            exhaust_runner_cross_section_area: exhaust_runner_cross_section,
            intake_port_flow: port_flow(INTAKE_FLOW_TABLE, lift_scale, size_scale),
            exhaust_port_flow: port_flow(EXHAUST_FLOW_TABLE, lift_scale, size_scale),

            intake_lobe_profile: harmonic_cam_lobe(
                layout.cam_duration_deg * DEG,
                0.9,
                layout.cam_lift_thou * THOU,
                256,
            ),
            exhaust_lobe_profile: harmonic_cam_lobe(
                layout.cam_duration_deg * DEG,
                0.9,
                layout.cam_lift_thou * THOU,
                256,
            ),
            intake_lobe_center: layout.lobe_center_deg * DEG,
            exhaust_lobe_center: layout.lobe_center_deg * DEG,
            cam_advance: 0.0,

            intakes: vec![intake],
            exhausts,

            banks,
            cylinders,

            timing_curve: default_timing_curve(),
            rev_limit: rpm(layout.redline_rpm * 1.03),
            limiter_duration: 0.1,

            fuel: FuelConfig::default(),
            crankcase_pressure: ATM,

            starter_torque: 300.0 * FT_LB * (cylinder_count as f64 / 8.0).max(0.35),
            starter_speed: rpm(300.0),
            starter_release_speed: rpm(700.0),
            starter_timeout: 8.0,

            throttle_gamma: 2.0,

            vehicle: VehicleConfig {
                // A clutch is rated above the engine it is bolted to, or it
                // slips instead of changing gear. Roughly 1.5x a 10 bar BMEP
                // peak torque, which is `bmep * displacement / (4 pi)`.
                max_clutch_torque: 1.5 * 1.0e6 * total_displacement / (4.0 * PI),
                ..VehicleConfig::default()
            },

            audio: layout.audio,
        };

        config.resolve_firing_order(layout.firing_order);

        if let Some(refine) = layout.refine {
            refine(&mut config);
            // The refinement may have moved journals or bank angles.
            config.resolve_firing_order(layout.firing_order);
        }

        config
    }

    /// Assigns each cylinder the compression-TDC cycle angle nearest its slot in
    /// the firing order.
    ///
    /// A cylinder reaches TDC twice per four-stroke cycle, 360° apart; only one
    /// of the two is the power stroke. Rather than hand-tabulating the answer
    /// per engine (and getting it wrong), derive both candidates from the crank
    /// geometry and pick whichever matches the requested firing order. This
    /// reproduces the hand-written ignition tables in the original assets
    /// exactly, and stays correct for layouts they never covered.
    pub fn resolve_firing_order(&mut self, firing_order: &[usize]) {
        let n = self.cylinders.len();
        if n == 0 {
            return;
        }
        let cycle = 4.0 * PI;
        let spacing = cycle / n as f64;

        for (slot, &cylinder) in firing_order.iter().enumerate() {
            if cylinder >= n {
                continue;
            }
            let desired = slot as f64 * spacing;

            let bank_angle = self.banks[self.cylinders[cylinder].bank].angle;
            let axis_angle = bank_angle + PI / 2.0;
            // Cycle angle at which this journal points up the bank axis.
            let base = positive_mod(
                self.tdc - axis_angle + self.cylinders[cylinder].journal_angle,
                2.0 * PI,
            );

            let candidates = [base, base + 2.0 * PI];
            let best = candidates
                .iter()
                .copied()
                .min_by(|a, b| {
                    let da = angular_distance(*a, desired, cycle);
                    let db = angular_distance(*b, desired, cycle);
                    da.partial_cmp(&db).unwrap()
                })
                .unwrap();

            self.cylinders[cylinder].ignition_angle = best;
        }
    }

    pub fn cylinder_count(&self) -> usize {
        self.cylinders.len()
    }

    /// Total swept volume, m³. Derived, never set: bore area x stroke x
    /// cylinders.
    ///
    /// The original computes the same number by sweeping each piston through a
    /// cycle and summing `pi r^2 (max_s - min_s)`, because its master/slave rod
    /// support means stroke is not always twice the crank throw. Without slave
    /// rods the analytic form is exact.
    pub fn displacement(&self) -> f64 {
        crate::gas::bore_surface_area(self.bore)
            * (self.crank_throw * 2.0)
            * self.cylinders.len() as f64
    }

    /// Cam lobe centreline for a cylinder, in camshaft radians.
    pub fn intake_lobe_angle(&self, cylinder: usize) -> f64 {
        (2.0 * PI + self.intake_lobe_center + self.cylinders[cylinder].ignition_angle) / 2.0
    }

    pub fn exhaust_lobe_angle(&self, cylinder: usize) -> f64 {
        (2.0 * PI - self.exhaust_lobe_center + self.cylinders[cylinder].ignition_angle) / 2.0
    }
}

fn angular_distance(a: f64, b: f64, modulus: f64) -> f64 {
    let d = positive_mod(a - b, modulus);
    d.min(modulus - d)
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

fn cyl(bank: usize, journal_angle_deg: f64) -> CylinderPlacement {
    CylinderPlacement {
        bank,
        journal_angle_deg,
    }
}

macro_rules! placements {
    ($($bank:expr, $angle:expr);* $(;)?) => {
        &[$(CylinderPlacement { bank: $bank, journal_angle_deg: $angle }),*]
    };
}

// Rod journal angles and firing orders have to agree: a cylinder can only fire
// at one of the two crank angles where its piston is at TDC. `resolve_firing_order`
// checks this by construction, and `tests::firing_order_is_evenly_spaced_for_even_fire_engines`
// fails loudly if a preset's journals and firing order contradict each other.
const SINGLE: &[CylinderPlacement] = placements![0, 0.0];
// Parallel twin on a 270° crank. Both cylinders stand upright side by side, so
// the crank alone decides the character: 360° pins fire evenly and shake, 180°
// pins fire 180/540, and 270° — this one — fires 270/450, which is close enough
// to a 90° V-twin's 270/450 that it sounds like one.
const TWIN_PARALLEL: &[CylinderPlacement] = placements![0, 0.0; 0, 270.0];
// 45° V-twin: the geometry alone produces the classic uneven 315°/405° pattern.
const TWIN_V: &[CylinderPlacement] = placements![0, 0.0; 1, 0.0];
const INLINE_3: &[CylinderPlacement] = placements![0, 0.0; 0, 120.0; 0, 240.0];
const INLINE_4: &[CylinderPlacement] = placements![0, 0.0; 0, 180.0; 0, 180.0; 0, 0.0];
const FLAT_4: &[CylinderPlacement] = placements![0, 0.0; 0, 180.0; 1, 0.0; 1, 180.0];
const INLINE_5: &[CylinderPlacement] = placements![0, 0.0; 0, 216.0; 0, 72.0; 0, 288.0; 0, 144.0];
const INLINE_6: &[CylinderPlacement] =
    placements![0, 0.0; 0, 120.0; 0, 240.0; 0, 240.0; 0, 120.0; 0, 0.0];
// 60° V6 with 60° split pins, which is what makes it fire evenly every 120°.
const V6_60: &[CylinderPlacement] =
    placements![0, 0.0; 0, 120.0; 0, 240.0; 1, 300.0; 1, 60.0; 1, 180.0];
// Boxer 6: each cylinder has its own crankpin and the opposing pins sit 180°
// apart (0/180, 240/60, 120/300). That is what separates a true boxer from a
// 180° V, where the opposed pair shares a pin — and it is what lets all six
// fire on an even 120° grid. Journals are arranged so the firing order below is
// the real 1-6-2-4-3-5.
const FLAT_6: &[CylinderPlacement] =
    placements![0, 0.0; 0, 240.0; 0, 120.0; 1, 180.0; 1, 60.0; 1, 300.0];
const V8_CROSS: &[CylinderPlacement] = placements![
    0, 0.0; 0, 90.0; 0, 270.0; 0, 180.0;
    1, 0.0; 1, 90.0; 1, 270.0; 1, 180.0
];
const V8_FLAT: &[CylinderPlacement] = placements![
    0, 0.0; 0, 180.0; 0, 180.0; 0, 0.0;
    1, 0.0; 1, 180.0; 1, 180.0; 1, 0.0
];
// Cylinder i and i+5 share a rod journal, as on a real 72° V10.
const V10_72: &[CylinderPlacement] = placements![
    0, 0.0; 0, 144.0; 0, 288.0; 0, 72.0; 0, 216.0;
    1, 0.0; 1, 144.0; 1, 288.0; 1, 72.0; 1, 216.0
];
// Fiat 500: a 360° crank. Both journals at the same angle, so the pistons rise
// together and fire one full revolution apart — a perfectly even beat, and the
// reason it sounds nothing like the 270° parallel twin above.
const FIAT_500: &[CylinderPlacement] = placements![0, 0.0; 0, 0.0];

/// Head flow for the 500's two-valve OHV chamber, SCFM at 28 inH2O against
/// valve lift in thou. A ~28 mm inlet valve; the exhaust side flows about three
/// quarters of the inlet, as usual for a plain pushrod head.
const FIAT_500_INTAKE_FLOW: &[(f64, f64)] = &[
    (0.0, 0.0),
    (50.0, 18.0),
    (100.0, 32.0),
    (150.0, 42.0),
    (200.0, 48.0),
    (250.0, 52.0),
    (300.0, 54.0),
];

const FIAT_500_EXHAUST_FLOW: &[(f64, f64)] = &[
    (0.0, 0.0),
    (50.0, 13.0),
    (100.0, 23.0),
    (150.0, 31.0),
    (200.0, 36.0),
    (250.0, 39.0),
    (300.0, 41.0),
];

fn fiat_500_port_flow(table: &[(f64, f64)]) -> Function {
    let mut f = Function::new(50.0 * THOU);
    for &(lift_thou, scfm) in table {
        f.add_sample(lift_thou * THOU, k_28in_h2o(scfm));
    }
    f
}

/// The parts of a 1968 Fiat 500 L that no size-based derivation could guess.
///
/// Figures published for engine 110F.000: 499.5 cc, 67.4 x 70 mm, 7.1:1, 18 hp
/// at 4600 rpm, one Weber 26 IMB. Rod length, compression height, inertia and
/// the flow curves are estimates from typical practice for an engine of this
/// type rather than published numbers.
fn refine_fiat_500(cfg: &mut EngineConfig) {
    let swept_per_cylinder = crate::gas::bore_surface_area(cfg.bore) * (cfg.crank_throw * 2.0);

    // 7.1:1 on a 249.75 cc cylinder.
    cfg.chamber_volume = swept_per_cylinder / (7.1 - 1.0);
    cfg.compression_height = 30.0 * MM;
    cfg.deck_height = cfg.crank_throw + cfg.rod_length + cfg.compression_height;
    cfg.windage_coefficient = 0.030 * (swept_per_cylinder * 2.0);

    cfg.intake_port_flow = fiat_500_port_flow(FIAT_500_INTAKE_FLOW);
    cfg.exhaust_port_flow = fiat_500_port_flow(FIAT_500_EXHAUST_FLOW);
    cfg.intake_runner_volume = 55.0 * CC;
    cfg.intake_runner_cross_section_area = (26.0 * MM) * (26.0 * MM);
    cfg.exhaust_runner_volume = 30.0 * CC;
    cfg.exhaust_runner_cross_section_area = (24.0 * MM) * (24.0 * MM);

    // One 26 mm Weber for both cylinders. At 4600 rpm the engine wants about
    // 40 CFM at 100% VE, and this is what stops it getting there — the reason
    // it makes 18 hp and runs out of breath below the limiter.
    let intake = &mut cfg.intakes[0];
    intake.plenum_volume = 0.55 * L;
    intake.plenum_cross_section_area = 5.3 * CM2;
    intake.input_flow_k = k_carb(42.0);
    intake.runner_flow_rate = k_carb(24.0);
    intake.runner_length = 18.0 * CM;

    // Both pots into one small silencer, tucked in behind the engine.
    cfg.exhausts = vec![ExhaustConfig {
        length: 1.4 * M,
        collector_cross_section_area: 9.0 * CM2,
        outlet_flow_rate: k_carb(60.0),
        primary_tube_length: 35.0 * CM,
        primary_flow_rate: k_carb(30.0),
        velocity_decay: 0.5,
        audio_volume: 0.22,
    }];

    for (cylinder, (length, attenuation)) in cfg
        .cylinders
        .iter_mut()
        .zip([(12.0 * CM, 1.0), (20.0 * CM, 0.95)])
    {
        cylinder.header_primary_length = length;
        cylinder.sound_attenuation = attenuation;
    }

    // Points and a distributor: little advance, and not much of it.
    let mut timing = Function::new(rpm(1000.0));
    for &(r, deg) in &[
        (0.0, 10.0),
        (1000.0, 10.0),
        (2000.0, 20.0),
        (3000.0, 26.0),
        (4000.0, 28.0),
        (5000.0, 28.0),
        (6000.0, 28.0),
    ] {
        timing.add_sample(rpm(r), deg * DEG);
    }
    cfg.timing_curve = timing;
    // Well above where it actually runs out of air; the carburettor is the
    // real limit, not the limiter.
    cfg.rev_limit = rpm(5400.0);

    cfg.starter_torque = 60.0 * FT_LB;
    cfg.starter_speed = rpm(280.0);
}

const V12_60: &[CylinderPlacement] = placements![
    0, 0.0; 0, 120.0; 0, 240.0; 0, 240.0; 0, 120.0; 0, 0.0;
    1, 0.0; 1, 120.0; 1, 240.0; 1, 240.0; 1, 120.0; 1, 0.0
];

fn audio(df_f_mix: f32, noise: f32, jitter: f32, convolution: f32) -> AudioParameters {
    AudioParameters {
        df_f_mix,
        air_noise: noise,
        input_sample_noise: jitter,
        convolution,
        ..Default::default()
    }
}

/// The built-in engines. `Preset::config()` produces a fully populated
/// [`EngineConfig`] that can then be edited before starting the simulation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Preset {
    Single,
    ParallelTwin,
    VTwin,
    Inline3,
    Inline4,
    Flat4,
    Inline5,
    Inline6,
    V6,
    Flat6,
    V8Crossplane,
    V8Flatplane,
    V10,
    V12,
    /// A specific car rather than a generic layout, so it sits after them.
    Fiat500,
}

/// Every preset, in ABI id order. This list is the single source of truth for
/// the ids crossing the WebAssembly boundary; `js/src/constants.js` mirrors it
/// and `js/test/worklet.test.mjs` checks the two have not drifted apart.
const ALL_PRESETS: &[Preset] = &[
    Preset::Single,
    Preset::ParallelTwin,
    Preset::VTwin,
    Preset::Inline3,
    Preset::Inline4,
    Preset::Flat4,
    Preset::Inline5,
    Preset::Inline6,
    Preset::V6,
    Preset::Flat6,
    Preset::V8Crossplane,
    Preset::V8Flatplane,
    Preset::V10,
    Preset::V12,
    Preset::Fiat500,
];

impl Preset {
    pub fn from_id(id: u32) -> Option<Preset> {
        ALL_PRESETS.get(id as usize).copied()
    }

    pub fn id(self) -> u32 {
        ALL_PRESETS.iter().position(|&p| p == self).unwrap() as u32
    }

    pub fn all() -> &'static [Preset] {
        ALL_PRESETS
    }

    pub fn layout(self) -> Layout {
        match self {
            Preset::Single => Layout {
                name: "Single Cylinder",
                bank_angles_deg: &[0.0],
                cylinders: SINGLE,
                firing_order: &[0],
                exhaust_banks: &[0],
                bore: 89.0 * MM,
                stroke: 76.0 * MM,
                rod_length: 130.0 * MM,
                chamber_volume: 60.0 * CC,
                redline_rpm: 7000.0,
                cam_duration_deg: 220.0,
                cam_lift_thou: 400.0,
                lobe_center_deg: 114.0,
                moment_of_inertia: 0.10,
                friction_torque: 4.0 * FT_LB,
                refine: None,
                idle_plate: 0.9945,
                audio: audio(0.02, 1.0, 0.4, 1.0),
            },
            // 690 cc parallel twin, of the modern 270°-crank sort.
            Preset::ParallelTwin => Layout {
                name: "270° Parallel Twin",
                bank_angles_deg: &[0.0],
                cylinders: TWIN_PARALLEL,
                firing_order: &[0, 1],
                // Both pots into one collector, as on nearly every road twin.
                exhaust_banks: &[0],
                bore: 80.0 * MM,
                stroke: 68.6 * MM,
                rod_length: 110.0 * MM,
                chamber_volume: 33.0 * CC,
                redline_rpm: 9500.0,
                cam_duration_deg: 240.0,
                cam_lift_thou: 335.0,
                lobe_center_deg: 110.0,
                moment_of_inertia: 0.12,
                friction_torque: 4.0 * FT_LB,
                refine: None,
                idle_plate: 0.9930,
                audio: audio(0.018, 1.0, 0.3, 1.0),
            },
            Preset::VTwin => Layout {
                name: "45° V-Twin",
                bank_angles_deg: &[22.5, -22.5],
                cylinders: TWIN_V,
                firing_order: &[0, 1],
                exhaust_banks: &[0, 1],
                bore: 88.8 * MM,
                stroke: 100.8 * MM,
                rod_length: 190.0 * MM,
                chamber_volume: 95.0 * CC,
                redline_rpm: 6000.0,
                cam_duration_deg: 210.0,
                cam_lift_thou: 420.0,
                lobe_center_deg: 110.0,
                moment_of_inertia: 0.30,
                friction_torque: 8.0 * FT_LB,
                refine: None,
                idle_plate: 0.9945,
                audio: audio(0.015, 1.0, 0.35, 1.0),
            },
            Preset::Inline3 => Layout {
                name: "Inline 3",
                bank_angles_deg: &[0.0],
                cylinders: INLINE_3,
                firing_order: &[0, 2, 1],
                exhaust_banks: &[0],
                bore: 74.0 * MM,
                stroke: 76.4 * MM,
                rod_length: 132.0 * MM,
                chamber_volume: 32.0 * CC,
                redline_rpm: 6800.0,
                cam_duration_deg: 220.0,
                cam_lift_thou: 380.0,
                lobe_center_deg: 112.0,
                moment_of_inertia: 0.20,
                friction_torque: 8.0 * FT_LB,
                refine: None,
                idle_plate: 0.9965,
                audio: audio(0.012, 1.0, 0.25, 1.0),
            },
            Preset::Inline4 => Layout {
                name: "Inline 4",
                bank_angles_deg: &[0.0],
                cylinders: INLINE_4,
                firing_order: &[0, 2, 3, 1],
                exhaust_banks: &[0],
                bore: 86.0 * MM,
                stroke: 86.0 * MM,
                rod_length: 143.0 * MM,
                chamber_volume: 50.0 * CC,
                redline_rpm: 7200.0,
                cam_duration_deg: 224.0,
                cam_lift_thou: 420.0,
                lobe_center_deg: 112.0,
                moment_of_inertia: 0.28,
                friction_torque: 10.0 * FT_LB,
                refine: None,
                idle_plate: 0.9965,
                audio: audio(0.01, 1.0, 0.2, 1.0),
            },
            Preset::Flat4 => Layout {
                name: "Flat 4",
                bank_angles_deg: &[90.0, -90.0],
                cylinders: FLAT_4,
                firing_order: &[0, 2, 3, 1],
                exhaust_banks: &[0, 1],
                bore: 99.5 * MM,
                stroke: 79.0 * MM,
                rod_length: 131.5 * MM,
                chamber_volume: 52.0 * CC,
                redline_rpm: 7000.0,
                cam_duration_deg: 224.0,
                cam_lift_thou: 420.0,
                lobe_center_deg: 112.0,
                moment_of_inertia: 0.30,
                friction_torque: 12.0 * FT_LB,
                refine: None,
                idle_plate: 0.9965,
                audio: audio(0.012, 1.0, 0.25, 1.0),
            },
            Preset::Inline5 => Layout {
                name: "Inline 5",
                bank_angles_deg: &[0.0],
                cylinders: INLINE_5,
                firing_order: &[0, 4, 3, 2, 1],
                exhaust_banks: &[0],
                bore: 81.0 * MM,
                stroke: 86.4 * MM,
                rod_length: 144.0 * MM,
                chamber_volume: 44.0 * CC,
                redline_rpm: 7000.0,
                cam_duration_deg: 226.0,
                cam_lift_thou: 430.0,
                lobe_center_deg: 113.0,
                moment_of_inertia: 0.35,
                friction_torque: 13.0 * FT_LB,
                refine: None,
                idle_plate: 0.9965,
                audio: audio(0.012, 1.0, 0.22, 1.0),
            },
            Preset::Inline6 => Layout {
                name: "Inline 6",
                bank_angles_deg: &[0.0],
                cylinders: INLINE_6,
                firing_order: &[0, 4, 2, 5, 1, 3],
                exhaust_banks: &[0],
                bore: 86.0 * MM,
                stroke: 86.0 * MM,
                rod_length: 142.0 * MM,
                chamber_volume: 52.0 * CC,
                redline_rpm: 7000.0,
                cam_duration_deg: 228.0,
                cam_lift_thou: 440.0,
                lobe_center_deg: 114.0,
                moment_of_inertia: 0.45,
                friction_torque: 16.0 * FT_LB,
                refine: None,
                idle_plate: 0.9965,
                audio: audio(0.01, 1.0, 0.18, 1.0),
            },
            Preset::V6 => Layout {
                name: "60° V6",
                bank_angles_deg: &[30.0, -30.0],
                cylinders: V6_60,
                firing_order: &[0, 4, 2, 3, 1, 5],
                exhaust_banks: &[0, 1],
                bore: 89.0 * MM,
                stroke: 79.0 * MM,
                rod_length: 145.0 * MM,
                chamber_volume: 52.0 * CC,
                redline_rpm: 7000.0,
                cam_duration_deg: 226.0,
                cam_lift_thou: 440.0,
                lobe_center_deg: 113.0,
                moment_of_inertia: 0.40,
                friction_torque: 15.0 * FT_LB,
                refine: None,
                idle_plate: 0.9965,
                audio: audio(0.012, 1.0, 0.2, 1.0),
            },
            // Air-cooled 3.6 litre flat six: 100 mm bore, 76.4 mm stroke.
            Preset::Flat6 => Layout {
                name: "Flat 6",
                bank_angles_deg: &[90.0, -90.0],
                cylinders: FLAT_6,
                // 1-6-2-4-3-5, the real thing.
                firing_order: &[0, 5, 1, 3, 2, 4],
                exhaust_banks: &[0, 1],
                bore: 100.0 * MM,
                stroke: 76.4 * MM,
                rod_length: 127.0 * MM,
                chamber_volume: 58.0 * CC,
                redline_rpm: 6800.0,
                cam_duration_deg: 228.0,
                cam_lift_thou: 433.0,
                lobe_center_deg: 112.0,
                moment_of_inertia: 0.38,
                friction_torque: 15.0 * FT_LB,
                refine: None,
                idle_plate: 0.9965,
                audio: audio(0.014, 1.0, 0.19, 1.0),
            },
            Preset::V8Crossplane => Layout {
                name: "90° V8 (crossplane)",
                bank_angles_deg: &[45.0, -45.0],
                cylinders: V8_CROSS,
                firing_order: &[0, 4, 3, 7, 6, 1, 5, 2],
                exhaust_banks: &[0, 1],
                bore: 103.25 * MM,
                stroke: 92.0 * MM,
                rod_length: 154.0 * MM,
                chamber_volume: 68.0 * CC,
                redline_rpm: 6500.0,
                cam_duration_deg: 226.0,
                cam_lift_thou: 520.0,
                lobe_center_deg: 114.0,
                moment_of_inertia: 0.65,
                friction_torque: 20.0 * FT_LB,
                refine: None,
                idle_plate: 0.9965,
                audio: audio(0.01, 1.0, 0.15, 1.0),
            },
            Preset::V8Flatplane => Layout {
                name: "90° V8 (flatplane)",
                bank_angles_deg: &[45.0, -45.0],
                cylinders: V8_FLAT,
                firing_order: &[0, 4, 2, 6, 3, 7, 1, 5],
                exhaust_banks: &[0, 1],
                bore: 94.0 * MM,
                stroke: 81.0 * MM,
                rod_length: 160.0 * MM,
                chamber_volume: 90.0 * CC,
                redline_rpm: 9000.0,
                cam_duration_deg: 230.0,
                cam_lift_thou: 551.0,
                lobe_center_deg: 116.0,
                moment_of_inertia: 0.50,
                friction_torque: 20.0 * FT_LB,
                refine: None,
                idle_plate: 0.9965,
                audio: audio(0.01, 1.0, 0.15, 1.0),
            },
            Preset::V10 => Layout {
                name: "72° V10",
                bank_angles_deg: &[36.0, -36.0],
                cylinders: V10_72,
                firing_order: &[0, 5, 1, 6, 2, 7, 3, 8, 4, 9],
                exhaust_banks: &[0, 1],
                bore: 88.0 * MM,
                stroke: 79.0 * MM,
                rod_length: 141.0 * MM,
                chamber_volume: 48.0 * CC,
                redline_rpm: 9500.0,
                cam_duration_deg: 234.0,
                cam_lift_thou: 500.0,
                lobe_center_deg: 116.0,
                moment_of_inertia: 0.55,
                friction_torque: 22.0 * FT_LB,
                refine: None,
                idle_plate: 0.9965,
                audio: audio(0.008, 1.0, 0.12, 1.0),
            },
            Preset::V12 => Layout {
                name: "60° V12",
                bank_angles_deg: &[30.0, -30.0],
                cylinders: V12_60,
                firing_order: &[0, 6, 4, 10, 2, 8, 5, 11, 1, 7, 3, 9],
                exhaust_banks: &[0, 1],
                bore: 88.0 * MM,
                stroke: 75.2 * MM,
                rod_length: 140.0 * MM,
                chamber_volume: 44.0 * CC,
                redline_rpm: 8500.0,
                cam_duration_deg: 232.0,
                cam_lift_thou: 480.0,
                lobe_center_deg: 116.0,
                moment_of_inertia: 0.70,
                friction_torque: 26.0 * FT_LB,
                refine: None,
                idle_plate: 0.9965,
                audio: audio(0.008, 1.0, 0.1, 1.0),
            },
            // 1968 Fiat 500 L, engine 110F.000. Air-cooled 499.5 cc OHV twin.
            // Named for its crank rather than the car, to sit alongside the
            // 270° twin above. Both journals share an angle, so the cylinders
            // fire a full revolution apart — a 360° twin, counting the firing
            // interval as the rest of the file does.
            Preset::Fiat500 => Layout {
                name: "360° Parallel Twin",
                bank_angles_deg: &[0.0],
                cylinders: FIAT_500,
                firing_order: &[0, 1],
                exhaust_banks: &[0],
                bore: 67.4 * MM,
                stroke: 70.0 * MM,
                rod_length: 118.0 * MM,
                // Overwritten by the refinement, which works it out from 7.1:1.
                chamber_volume: 41.0 * CC,
                redline_rpm: 4600.0,
                cam_duration_deg: 200.0,
                cam_lift_thou: 260.0,
                lobe_center_deg: 112.0,
                // Small, but the cast flywheel also drives the cooling fan.
                moment_of_inertia: 0.085,
                friction_torque: 3.0 * FT_LB,
                refine: Some(refine_fiat_500),
                // Wound further open than a car engine's: a 500 idles near 800.
                idle_plate: 0.9860,
                // Air-cooled and thin-panelled: mechanical edge, little damping.
                audio: audio(0.022, 1.0, 0.32, 1.0),
            },
        }
    }

    pub fn config(self) -> EngineConfig {
        EngineConfig::from_layout(&self.layout())
    }

    /// Stable machine-readable name. Matches the strings in `PRESETS` on the
    /// JavaScript side.
    pub fn slug(self) -> &'static str {
        match self {
            Preset::Single => "single",
            Preset::ParallelTwin => "inline2",
            Preset::VTwin => "v_twin",
            Preset::Inline3 => "inline3",
            Preset::Inline4 => "inline4",
            Preset::Flat4 => "flat4",
            Preset::Inline5 => "inline5",
            Preset::Inline6 => "inline6",
            Preset::V6 => "v6",
            Preset::Flat6 => "flat6",
            Preset::V8Crossplane => "v8_crossplane",
            Preset::V8Flatplane => "v8_flatplane",
            Preset::V10 => "v10",
            Preset::V12 => "v12",
            Preset::Fiat500 => "fiat500",
        }
    }

    pub fn from_slug(slug: &str) -> Option<Preset> {
        ALL_PRESETS.iter().copied().find(|p| p.slug() == slug)
    }

    pub fn name(self) -> &'static str {
        self.layout().name
    }
}

impl Default for EngineConfig {
    fn default() -> Self {
        Preset::V8Crossplane.config()
    }
}

// Keep `cyl` referenced for downstream construction of custom layouts.
#[allow(dead_code)]
fn _unused_helper() -> CylinderPlacement {
    cyl(0, 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn firing_order_is_evenly_spaced_for_even_fire_engines() {
        for preset in [
            Preset::Inline4,
            Preset::Inline6,
            Preset::V6,
            Preset::Flat6,
            Preset::V8Flatplane,
            Preset::V8Crossplane,
            Preset::V10,
            Preset::V12,
        ] {
            let cfg = preset.config();
            let layout = preset.layout();
            let n = cfg.cylinders.len();
            let spacing = 4.0 * PI / n as f64;

            for (slot, &cylinder) in layout.firing_order.iter().enumerate() {
                let expected = slot as f64 * spacing;
                let actual = cfg.cylinders[cylinder].ignition_angle;
                let err = angular_distance(actual, expected, 4.0 * PI);
                assert!(
                    err < 1e-6,
                    "{}: cylinder {cylinder} fires at {:.1}°, expected {:.1}°",
                    layout.name,
                    actual / DEG,
                    expected / DEG
                );
            }
        }
    }

    #[test]
    fn ignition_angles_are_unique() {
        for &preset in Preset::all() {
            let cfg = preset.config();
            let mut angles: Vec<f64> = cfg
                .cylinders
                .iter()
                .map(|c| (c.ignition_angle / DEG).round())
                .collect();
            angles.sort_by(|a, b| a.partial_cmp(b).unwrap());
            angles.dedup();
            assert_eq!(
                angles.len(),
                cfg.cylinders.len(),
                "{} has duplicate ignition angles",
                preset.name()
            );
        }
    }

    #[test]
    fn slugs_are_unique_and_round_trip() {
        let mut slugs: Vec<&str> = Preset::all().iter().map(|p| p.slug()).collect();
        let count = slugs.len();
        slugs.sort_unstable();
        slugs.dedup();
        assert_eq!(slugs.len(), count, "duplicate preset slug");

        for &preset in Preset::all() {
            assert_eq!(Preset::from_slug(preset.slug()), Some(preset));
        }
        assert_eq!(Preset::from_slug("w16"), None);
    }

    /// Gaps between consecutive firing events over one 720° cycle, in degrees.
    fn firing_gaps(preset: Preset) -> Vec<f64> {
        let cfg = preset.config();
        let mut angles: Vec<f64> = cfg
            .cylinders
            .iter()
            .map(|c| c.ignition_angle / DEG)
            .collect();
        angles.sort_by(|a, b| a.partial_cmp(b).unwrap());

        (0..angles.len())
            .map(|i| {
                let next = if i + 1 == angles.len() {
                    angles[0] + 720.0
                } else {
                    angles[i + 1]
                };
                (next - angles[i]).round()
            })
            .collect()
    }

    #[test]
    fn twins_fire_unevenly_in_the_right_way() {
        // A twin's whole character is in the gap between its two power strokes,
        // and that gap falls out of the crank geometry rather than a table.

        // 270° crank: 270 then 450, which is why a modern parallel twin sounds
        // like a 90° V-twin rather than like half an inline four.
        assert_eq!(firing_gaps(Preset::ParallelTwin), vec![270.0, 450.0]);

        // 45° V-twin on a shared pin: the classic 315/405 potato-potato.
        assert_eq!(firing_gaps(Preset::VTwin), vec![405.0, 315.0]);
    }

    #[test]
    fn fiat_500_matches_the_published_figures() {
        let cfg = Preset::Fiat500.config();

        // 499.5 cc from 67.4 x 70 mm.
        assert!(
            (cfg.displacement() / CC - 499.5).abs() < 0.5,
            "{:.1} cc",
            cfg.displacement() / CC
        );

        // 7.1:1.
        let swept = cfg.displacement() / 2.0;
        let ratio = (swept + cfg.chamber_volume) / cfg.chamber_volume;
        assert!((ratio - 7.1).abs() < 0.01, "compression {ratio}");

        // 360° crank: both cylinders fire one revolution apart.
        assert_eq!(firing_gaps(Preset::Fiat500), vec![360.0, 360.0]);

        // One carburettor, one silencer.
        assert_eq!(cfg.intakes.len(), 1);
        assert_eq!(cfg.exhausts.len(), 1);
    }

    #[test]
    fn the_refinement_hook_runs_and_only_for_the_engines_that_want_it() {
        // Without the hook the Fiat would inherit the parallel twin's derived
        // breathing, which is sized for 690 cc.
        let fiat = Preset::Fiat500.config();
        let twin = Preset::ParallelTwin.config();
        assert!(
            fiat.intakes[0].input_flow_k < twin.intakes[0].input_flow_k,
            "the 500 should breathe through a much smaller carburettor"
        );

        for &preset in Preset::all() {
            let layout = preset.layout();
            if preset != Preset::Fiat500 {
                assert!(
                    layout.refine.is_none(),
                    "{} unexpectedly refines its layout",
                    preset.name()
                );
            }
        }
    }

    #[test]
    fn flat_six_is_a_true_boxer() {
        // A boxer gives every cylinder its own crankpin, with the opposing pins
        // 180° apart. (Share the pin instead and you have a 180° V, whose
        // opposed pair reaches TDC 180° apart — which cannot fire on an even
        // 120° grid.) Check every left pin has a right pin opposite it.
        let cfg = Preset::Flat6.config();

        let pins = |bank: usize| -> Vec<f64> {
            cfg.cylinders
                .iter()
                .filter(|c| c.bank == bank)
                .map(|c| positive_mod(c.journal_angle, 2.0 * PI) / DEG)
                .collect()
        };

        let left = pins(0);
        let right = pins(1);
        assert_eq!(left.len(), 3);
        assert_eq!(right.len(), 3);

        for l in &left {
            let opposite = positive_mod(l + 180.0, 360.0);
            assert!(
                right.iter().any(|r| (r - opposite).abs() < 1e-6),
                "no pin opposite {l}°; right bank has {right:?}"
            );
        }
    }

    #[test]
    fn flat_six_fires_one_six_two_four_three_five() {
        let cfg = Preset::Flat6.config();
        let mut events: Vec<(usize, f64)> = cfg
            .cylinders
            .iter()
            .enumerate()
            .map(|(i, c)| (i, c.ignition_angle))
            .collect();
        events.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());

        let order: Vec<usize> = events.iter().map(|e| e.0).collect();
        assert_eq!(order, vec![0, 5, 1, 3, 2, 4], "not the real 1-6-2-4-3-5");

        // Banks must alternate, which is what gives a flat six its even beat.
        let banks: Vec<usize> = order.iter().map(|&i| cfg.cylinders[i].bank).collect();
        assert_eq!(banks, vec![0, 1, 0, 1, 0, 1]);
    }

    #[test]
    fn flatplane_v8_matches_original_asset() {
        // The Ferrari F136 configuration in the original asset set wires the
        // cylinders at these cycle angles.
        let cfg = Preset::V8Flatplane.config();
        let expected_deg = [0.0, 540.0, 180.0, 360.0, 90.0, 630.0, 270.0, 450.0];
        for (i, &e) in expected_deg.iter().enumerate() {
            let actual = cfg.cylinders[i].ignition_angle / DEG;
            assert!((actual - e).abs() < 1e-6, "cylinder {i}: {actual}° != {e}°");
        }
    }
}
