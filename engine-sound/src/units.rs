//! Physical constants and unit conversions.
//!
//! Port of `include/constants.h` and `include/units.h`.

// The original hard-codes truncated literals for these; the standard constants
// differ by around 1e-12 relative, which is far below anything that reaches an
// ear or changes a simulation step.
pub use core::f64::consts::E;
pub use core::f64::consts::PI;
pub use core::f64::consts::SQRT_2 as ROOT_2;

/// Universal gas constant, J/(mol K).
pub const R: f64 = 8.31446261815324;

// Force
pub const N: f64 = 1.0;
pub const LBF: f64 = N * 4.44822;

// Mass
pub const KG: f64 = 1.0;
pub const G: f64 = KG / 1000.0;
pub const LB: f64 = 0.45359237 * KG;

// Distance
pub const M: f64 = 1.0;
pub const CM: f64 = M / 100.0;
pub const MM: f64 = M / 1000.0;
pub const INCH: f64 = CM * 2.54;
pub const FOOT: f64 = INCH * 12.0;
pub const THOU: f64 = INCH / 1000.0;

// Time
pub const SEC: f64 = 1.0;
pub const MINUTE: f64 = 60.0 * SEC;

// Torque
pub const NM: f64 = N * M;
pub const FT_LB: f64 = FOOT * LBF;

// Volume
pub const M3: f64 = 1.0;
pub const CC: f64 = CM * CM * CM;
pub const L: f64 = CC * 1000.0;

// Molecular
pub const MOL: f64 = 1.0;
pub const LBMOL: f64 = MOL * 453.59237;
pub const SCFM: f64 = 0.002641 * LBMOL / MINUTE;

// Area
pub const M2: f64 = 1.0;
pub const CM2: f64 = CM * CM;

// Pressure
pub const PA: f64 = 1.0;
pub const KPA: f64 = PA * 1000.0;
pub const ATM: f64 = 101.325 * KPA;
pub const PSI: f64 = LBF / (INCH * INCH);
pub const INHG: f64 = PA * 3386.3886666666713;
pub const INH2O: f64 = INHG * 0.0734824;

// Temperature
pub const K0: f64 = 273.15;

// Energy
pub const J: f64 = 1.0;
pub const KJ: f64 = J * 1000.0;

// Angles
pub const RAD: f64 = 1.0;
pub const DEG: f64 = RAD * (PI / 180.0);

/// Molar mass of dry air, kg/mol.
pub const AIR_MOLECULAR_MASS: f64 = 28.97 * G / MOL;

/// rad/s from RPM.
#[inline]
pub const fn rpm(rpm: f64) -> f64 {
    rpm * 0.104719755
}

/// RPM from rad/s.
#[inline]
pub const fn to_rpm(rad_s: f64) -> f64 {
    rad_s / 0.104719755
}

/// Kelvin from Celsius.
#[inline]
pub const fn celsius(t_c: f64) -> f64 {
    t_c + K0
}

#[inline]
pub fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    if x < lo {
        lo
    } else if x > hi {
        hi
    } else {
        x
    }
}

#[inline]
pub fn clamp01(x: f64) -> f64 {
    clamp(x, 0.0, 1.0)
}

#[inline]
pub fn positive_mod(x: f64, m: f64) -> f64 {
    let r = x % m;
    if r < 0.0 {
        r + m
    } else {
        r
    }
}
