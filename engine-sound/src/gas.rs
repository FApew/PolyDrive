//! Lumped-parameter compressible gas system with bulk momentum.
//!
//! Port of `include/gas_system.h` / `src/gas_system.cpp`. This is what actually
//! produces the sound: the pressure waves bouncing around the exhaust runner
//! are the raw excitation signal handed to the synthesizer.

use crate::units::{clamp, ATM, INH2O, INHG, PI, R, SCFM};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mix {
    pub p_fuel: f64,
    pub p_inert: f64,
    pub p_o2: f64,
}

impl Default for Mix {
    fn default() -> Self {
        Self {
            p_fuel: 0.0,
            p_inert: 1.0,
            p_o2: 0.0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct GasSystem {
    pub n_mol: f64,
    /// Thermal (internal) kinetic energy.
    pub e_k: f64,
    pub volume: f64,
    pub momentum: [f64; 2],
    pub mix: Mix,

    degrees_of_freedom: i32,
    choked_flow_limit: f64,
    choked_flow_factor: f64,

    width: f64,
    height: f64,
    dx: f64,
    dy: f64,
}

impl Default for GasSystem {
    fn default() -> Self {
        Self {
            n_mol: 0.0,
            e_k: 0.0,
            volume: 0.0,
            momentum: [0.0, 0.0],
            mix: Mix::default(),
            degrees_of_freedom: 5,
            choked_flow_limit: choked_flow_limit(5),
            choked_flow_factor: choked_flow_rate(5),
            width: 0.0,
            height: 0.0,
            dx: 0.0,
            dy: 0.0,
        }
    }
}

#[inline]
pub const fn heat_capacity_ratio(degrees_of_freedom: i32) -> f64 {
    1.0 + (2.0 / degrees_of_freedom as f64)
}

#[inline]
pub fn choked_flow_limit(degrees_of_freedom: i32) -> f64 {
    let hcr = heat_capacity_ratio(degrees_of_freedom);
    (2.0 / (hcr + 1.0)).powf(hcr / (hcr - 1.0))
}

#[inline]
pub fn choked_flow_rate(degrees_of_freedom: i32) -> f64 {
    let hcr = heat_capacity_ratio(degrees_of_freedom);
    hcr.sqrt() * (2.0 / (hcr + 1.0)).powf((hcr + 1.0) / (2.0 * (hcr - 1.0)))
}

#[inline]
pub const fn kinetic_energy_per_mol_at(t: f64, degrees_of_freedom: i32) -> f64 {
    0.5 * t * R * degrees_of_freedom as f64
}

impl GasSystem {
    pub fn set_geometry(&mut self, width: f64, height: f64, dx: f64, dy: f64) {
        self.width = width;
        self.height = height;
        self.dx = dx;
        self.dy = dy;
    }

    pub fn initialize(&mut self, p: f64, v: f64, t: f64) {
        self.initialize_with(p, v, t, Mix::default(), 5);
    }

    pub fn initialize_with(&mut self, p: f64, v: f64, t: f64, mix: Mix, degrees_of_freedom: i32) {
        self.degrees_of_freedom = degrees_of_freedom;
        self.n_mol = p * v / (R * t);
        self.volume = v;
        self.e_k = t * (0.5 * degrees_of_freedom as f64 * self.n_mol * R);
        self.mix = mix;
        self.momentum = [0.0, 0.0];
        self.choked_flow_limit = choked_flow_limit(degrees_of_freedom);
        self.choked_flow_factor = choked_flow_rate(degrees_of_freedom);
    }

    pub fn reset(&mut self, p: f64, t: f64, mix: Mix) {
        self.n_mol = p * self.volume / (R * t);
        self.e_k = t * (0.5 * self.degrees_of_freedom as f64 * self.n_mol * R);
        self.mix = mix;
        self.momentum = [0.0, 0.0];
    }

    #[inline]
    pub fn degrees_of_freedom(&self) -> i32 {
        self.degrees_of_freedom
    }

    #[inline]
    pub fn heat_capacity_ratio(&self) -> f64 {
        heat_capacity_ratio(self.degrees_of_freedom)
    }

    #[inline]
    pub fn n(&self) -> f64 {
        self.n_mol
    }

    #[inline]
    pub fn mass(&self) -> f64 {
        crate::units::AIR_MOLECULAR_MASS * self.n_mol
    }

    #[inline]
    pub fn approximate_density(&self) -> f64 {
        self.mass() / self.volume
    }

    #[inline]
    pub fn pressure(&self) -> f64 {
        if self.volume != 0.0 {
            self.e_k / (0.5 * self.degrees_of_freedom as f64 * self.volume)
        } else {
            0.0
        }
    }

    #[inline]
    pub fn temperature(&self) -> f64 {
        if self.n_mol == 0.0 {
            0.0
        } else {
            self.e_k / (0.5 * self.degrees_of_freedom as f64 * self.n_mol * R)
        }
    }

    #[inline]
    pub fn kinetic_energy(&self) -> f64 {
        self.e_k
    }

    #[inline]
    pub fn kinetic_energy_of(&self, n: f64) -> f64 {
        (self.e_k / self.n_mol) * n
    }

    #[inline]
    pub fn kinetic_energy_per_mol(&self) -> f64 {
        self.kinetic_energy_of(1.0)
    }

    #[inline]
    pub fn bulk_kinetic_energy(&self) -> f64 {
        let m = self.mass();
        if m == 0.0 {
            return 0.0;
        }
        let v_x = self.momentum[0] / m;
        let v_y = self.momentum[1] / m;
        0.5 * m * (v_x * v_x + v_y * v_y)
    }

    #[inline]
    pub fn total_energy(&self) -> f64 {
        if self.n_mol == 0.0 {
            return 0.0;
        }
        self.e_k + self.bulk_kinetic_energy()
    }

    /// Speed of sound.
    #[inline]
    pub fn c(&self) -> f64 {
        if self.n_mol == 0.0 || self.e_k == 0.0 {
            return 0.0;
        }
        (self.pressure() * self.heat_capacity_ratio() / self.approximate_density()).sqrt()
    }

    #[inline]
    pub fn velocity_x(&self) -> f64 {
        if self.n_mol == 0.0 {
            0.0
        } else {
            self.momentum[0] / self.mass()
        }
    }

    #[inline]
    pub fn velocity_y(&self) -> f64 {
        if self.n_mol == 0.0 {
            0.0
        } else {
            self.momentum[1] / self.mass()
        }
    }

    /// Compressible dynamic (stagnation minus static) pressure in direction
    /// `(dx, dy)`. The exhaust-pulse signal is built from this.
    pub fn dynamic_pressure(&self, dx: f64, dy: f64) -> f64 {
        if self.n_mol == 0.0 || self.e_k == 0.0 {
            return 0.0;
        }

        let inverse_mass = 1.0 / self.mass();
        let v = inverse_mass * (dx * self.momentum[0] + dy * self.momentum[1]);
        if v <= 0.0 {
            return 0.0;
        }

        let hcr = self.heat_capacity_ratio();
        let static_pressure = self.pressure();
        let density = self.approximate_density();
        let c_squared = static_pressure * hcr / density;
        let mach_squared = v * v / c_squared;

        let x = 1.0 + ((hcr - 1.0) / 2.0) * mach_squared;
        let x_d = match self.degrees_of_freedom {
            3 => x * x * x * x * x,
            5 => {
                let x_2 = x * x;
                let x_3 = x_2 * x;
                x_3 * x_3 * x
            }
            _ => x,
        };

        static_pressure * (x_d.sqrt() - 1.0)
    }

    #[inline]
    pub fn n_fuel(&self) -> f64 {
        self.mix.p_fuel * self.n_mol
    }

    #[inline]
    pub fn n_inert(&self) -> f64 {
        self.mix.p_inert * self.n_mol
    }

    #[inline]
    pub fn n_o2(&self) -> f64 {
        self.mix.p_o2 * self.n_mol
    }

    pub fn set_volume(&mut self, v: f64) {
        self.change_volume(v - self.volume);
    }

    pub fn change_volume(&mut self, dv: f64) {
        let v = self.volume;
        let l = (v + dv).powf(1.0 / 3.0);
        let surface_area = l * l;
        let dl = -dv / surface_area;
        let w = dl * self.pressure() * surface_area;

        self.volume += dv;
        self.e_k += w;
    }

    pub fn change_energy(&mut self, de: f64) {
        self.e_k += de;
    }

    pub fn change_temperature(&mut self, dt: f64) {
        self.e_k += dt * 0.5 * self.degrees_of_freedom as f64 * self.n_mol * R;
    }

    /// Burns `n` moles of the given mix; returns the number of moles of fuel
    /// consumed. Assumes `25 O2 + 2 C8H16 -> 16 CO2 + 18 H2O`.
    pub fn react(&mut self, n: f64, mix: Mix) -> f64 {
        let l_n_fuel = mix.p_fuel * n;
        let l_n_o2 = mix.p_o2 * n;

        let system_n_fuel = self.n_fuel();
        let system_n_o2 = self.n_o2();
        let system_n_inert = self.n_inert();
        let system_n = self.n_mol;

        const IDEAL_O2_RATIO: f64 = 25.0 / 2.0;
        const IDEAL_FUEL_RATIO: f64 = 2.0 / 25.0;
        const OUTPUT_INPUT_RATIO: f64 = (16.0 + 18.0) / (25.0 + 2.0);

        let ideal_fuel_n = IDEAL_FUEL_RATIO * l_n_o2;
        let ideal_o2_n = IDEAL_O2_RATIO * l_n_fuel;

        let a_n_fuel = system_n_fuel.min(l_n_fuel).min(ideal_fuel_n);
        let a_n_o2 = system_n_o2.min(l_n_o2).min(ideal_o2_n);

        let reactants_n = a_n_fuel + a_n_o2;
        let products_n = OUTPUT_INPUT_RATIO * reactants_n;
        let dn = products_n - reactants_n;

        self.n_mol += dn;

        let new_n_fuel = system_n_fuel - a_n_fuel;
        let new_n_o2 = system_n_o2 - a_n_o2;
        let new_n_inert = system_n_inert + products_n;
        let new_n = system_n + dn;

        if new_n != 0.0 {
            self.mix.p_fuel = new_n_fuel / new_n;
            self.mix.p_inert = new_n_inert / new_n;
            self.mix.p_o2 = new_n_o2 / new_n;
        } else {
            self.mix = Mix {
                p_fuel: 0.0,
                p_inert: 0.0,
                p_o2: 0.0,
            };
        }

        a_n_fuel
    }

    pub fn lose_n(&mut self, dn: f64, e_k_per_mol: f64) -> f64 {
        self.e_k -= e_k_per_mol * dn;
        self.n_mol -= dn;
        if self.n_mol < 0.0 {
            self.n_mol = 0.0;
        }
        dn
    }

    pub fn gain_n(&mut self, dn: f64, e_k_per_mol: f64, mix: Mix) -> f64 {
        let current_n = self.n_mol;
        let next_n = current_n + dn;

        self.e_k += dn * e_k_per_mol;
        self.n_mol = next_n;

        if next_n != 0.0 {
            self.mix.p_fuel = (self.mix.p_fuel * current_n + dn * mix.p_fuel) / next_n;
            self.mix.p_inert = (self.mix.p_inert * current_n + dn * mix.p_inert) / next_n;
            self.mix.p_o2 = (self.mix.p_o2 * current_n + dn * mix.p_o2) / next_n;
        } else {
            self.mix = Mix {
                p_fuel: 0.0,
                p_inert: 0.0,
                p_o2: 0.0,
            };
        }

        -dn
    }

    /// Clamps bulk velocity to the local speed of sound, returning the excess
    /// as thermal energy.
    pub fn dissipate_excess_velocity(&mut self) {
        let v_x = self.velocity_x();
        let v_y = self.velocity_y();
        let v_squared = v_x * v_x + v_y * v_y;
        let c = self.c();
        let c_squared = c * c;

        if c_squared >= v_squared || v_squared == 0.0 {
            return;
        }

        let k = (c_squared / v_squared).sqrt();
        self.momentum[0] *= k;
        self.momentum[1] *= k;
        self.e_k += 0.5 * self.mass() * (v_squared - c_squared);

        if self.e_k < 0.0 {
            self.e_k = 0.0;
        }
    }

    /// Converts the dynamic pressure imbalance across the control volume into
    /// bulk momentum. This is the term that makes the runner ring.
    pub fn update_velocity(&mut self, dt: f64, beta: f64) {
        if self.n_mol == 0.0 {
            return;
        }

        let depth = self.volume / (self.width * self.height);

        let p0 = self.dynamic_pressure(self.dx, self.dy);
        let p1 = self.dynamic_pressure(-self.dx, -self.dy);
        let p2 = self.dynamic_pressure(self.dy, self.dx);
        let p3 = self.dynamic_pressure(-self.dy, -self.dx);

        let p_sa_0 = p0 * (self.height * depth);
        let p_sa_1 = p1 * (self.height * depth);
        let p_sa_2 = p2 * (self.width * depth);
        let p_sa_3 = p3 * (self.width * depth);

        let mut d_momentum_x = 0.0;
        let mut d_momentum_y = 0.0;

        d_momentum_x += p_sa_0 * self.dx;
        d_momentum_y += p_sa_0 * self.dy;
        d_momentum_x -= p_sa_1 * self.dx;
        d_momentum_y -= p_sa_1 * self.dy;
        d_momentum_x += p_sa_2 * self.dy;
        d_momentum_y += p_sa_2 * self.dx;
        d_momentum_x -= p_sa_3 * self.dy;
        d_momentum_y -= p_sa_3 * self.dx;

        let m = self.mass();
        let inv_m = 1.0 / m;
        let v0_x = self.momentum[0] * inv_m;
        let v0_y = self.momentum[1] * inv_m;

        self.momentum[0] -= d_momentum_x * dt * beta;
        self.momentum[1] -= d_momentum_y * dt * beta;

        let v1_x = self.momentum[0] * inv_m;
        let v1_y = self.momentum[1] * inv_m;

        self.e_k -= 0.5 * m * (v1_x * v1_x - v0_x * v0_x);
        self.e_k -= 0.5 * m * (v1_y * v1_y - v0_y * v0_y);

        if self.e_k < 0.0 {
            self.e_k = 0.0;
        }
    }

    pub fn dissipate_velocity(&mut self, dt: f64, time_constant: f64) {
        if self.n_mol == 0.0 {
            return;
        }

        let inv_mass = 1.0 / self.mass();
        let v_x = self.momentum[0] * inv_mass;
        let v_y = self.momentum[1] * inv_mass;
        let v_squared = v_x * v_x + v_y * v_y;

        let s = dt / (dt + time_constant);
        self.momentum[0] *= 1.0 - s;
        self.momentum[1] *= 1.0 - s;

        let nv_x = self.momentum[0] * inv_mass;
        let nv_y = self.momentum[1] * inv_mass;
        let nv_squared = nv_x * nv_x + nv_y * nv_y;

        self.e_k += 0.5 * self.mass() * (v_squared - nv_squared);
    }

    pub fn pressure_equilibrium_max_flow_env(&self, p_env: f64, t_env: f64) -> f64 {
        if self.pressure() > p_env {
            -(p_env * (0.5 * self.degrees_of_freedom as f64 * self.volume) - self.e_k)
                / self.kinetic_energy_per_mol()
        } else {
            let e_k_per_mol_env = 0.5 * t_env * R * self.degrees_of_freedom as f64;
            -(p_env * (0.5 * self.degrees_of_freedom as f64 * self.volume) - self.e_k)
                / e_k_per_mol_env
        }
    }

    /// Flow to a fixed-property environment (blowby, atmosphere).
    pub fn flow_env(&mut self, k_flow: f64, dt: f64, p_env: f64, t_env: f64, mix: Mix) -> f64 {
        let max_flow = self.pressure_equilibrium_max_flow_env(p_env, t_env);
        let mut flow = dt
            * flow_rate(
                k_flow,
                self.pressure(),
                p_env,
                self.temperature(),
                t_env,
                self.heat_capacity_ratio(),
                self.choked_flow_limit,
                self.choked_flow_factor,
            );

        if flow.abs() > max_flow.abs() {
            flow = max_flow;
        }

        if flow < 0.0 {
            let bulk_0 = self.bulk_kinetic_energy();
            self.gain_n(
                -flow,
                kinetic_energy_per_mol_at(t_env, self.degrees_of_freedom),
                mix,
            );
            let bulk_1 = self.bulk_kinetic_energy();
            self.e_k += bulk_1 - bulk_0;
        } else {
            let starting_n = self.n_mol;
            let e_k_per_mol = self.kinetic_energy_per_mol();
            self.lose_n(flow, e_k_per_mol);
            if starting_n != 0.0 {
                self.momentum[0] -= (flow / starting_n) * self.momentum[0];
                self.momentum[1] -= (flow / starting_n) * self.momentum[1];
            }
        }

        flow
    }
}

/// Molar flow rate through an orifice (choked and subsonic branches).
#[allow(clippy::too_many_arguments)]
pub fn flow_rate(
    k_flow: f64,
    p0: f64,
    p1: f64,
    t0: f64,
    t1: f64,
    hcr: f64,
    choked_flow_limit: f64,
    choked_flow_rate_cached: f64,
) -> f64 {
    if k_flow == 0.0 {
        return 0.0;
    }

    let (direction, t_upstream, p_upstream, p_downstream) = if p0 > p1 {
        (1.0, t0, p0, p1)
    } else {
        (-1.0, t1, p1, p0)
    };

    if p_upstream <= 0.0 || t_upstream <= 0.0 {
        return 0.0;
    }

    let p_ratio = p_downstream / p_upstream;
    let mut rate;
    if p_ratio <= choked_flow_limit {
        rate = choked_flow_rate_cached;
        rate /= (R * t_upstream).sqrt();
    } else {
        let s = p_ratio.powf(1.0 / hcr);
        rate = (2.0 * hcr) / (hcr - 1.0);
        rate *= s * (s - p_ratio);
        rate = (rate.max(0.0) / (R * t_upstream)).sqrt();
    }

    rate * direction * p_upstream * k_flow
}

/// Flow constant for a component that passes `target_flow_rate` at the given
/// pressure drop.
pub fn flow_constant(target_flow_rate: f64, p: f64, pressure_drop: f64, t: f64, hcr: f64) -> f64 {
    let p_0 = p;
    let p_t = p - pressure_drop;

    let limit = (2.0 / (hcr + 1.0)).powf(hcr / (hcr - 1.0));
    let p_ratio = p_t / p_0;

    let mut rate;
    if p_ratio <= limit {
        rate = hcr.sqrt();
        rate *= (2.0 / (hcr + 1.0)).powf((hcr + 1.0) / (2.0 * (hcr - 1.0)));
    } else {
        rate = (2.0 * hcr) / (hcr - 1.0);
        rate *= 1.0 - p_ratio.powf((hcr - 1.0) / hcr);
        rate = rate.sqrt();
        rate *= p_ratio.powf(1.0 / hcr);
    }

    rate *= p_0 / (R * t).sqrt();

    target_flow_rate / rate
}

/// Flow constant from a head-flow-bench rating (SCFM @ 28 inH2O).
pub fn k_28in_h2o(flow_rate_scfm: f64) -> f64 {
    flow_constant(
        flow_rate_scfm * SCFM,
        ATM,
        28.0 * INH2O,
        crate::units::celsius(25.0),
        heat_capacity_ratio(5),
    )
}

/// Flow constant from a carburettor rating (SCFM @ 1.5 inHg).
pub fn k_carb(flow_rate_scfm: f64) -> f64 {
    flow_constant(
        flow_rate_scfm * SCFM,
        ATM,
        1.5 * INHG,
        crate::units::celsius(25.0),
        heat_capacity_ratio(5),
    )
}

#[derive(Clone, Copy, Debug)]
pub struct FlowParameters {
    pub k_flow: f64,
    pub dt: f64,
    pub direction_x: f64,
    pub direction_y: f64,
    pub cross_section_area_0: f64,
    pub cross_section_area_1: f64,
}

/// Transfers mass, energy and momentum between two gas systems.
///
/// Direct port of `GasSystem::flow(const FlowParameters &)`. Positive return
/// means net flow from `system_0` into `system_1`.
pub fn flow(params: &FlowParameters, system_0: &mut GasSystem, system_1: &mut GasSystem) -> f64 {
    let p_0 =
        system_0.pressure() + system_0.dynamic_pressure(params.direction_x, params.direction_y);
    let p_1 =
        system_1.pressure() + system_1.dynamic_pressure(-params.direction_x, -params.direction_y);

    let forward = p_0 > p_1;

    let (dx, dy, direction) = if forward {
        (params.direction_x, params.direction_y, 1.0)
    } else {
        (-params.direction_x, -params.direction_y, -1.0)
    };

    let (source_cross_section, sink_cross_section) = if forward {
        (params.cross_section_area_0, params.cross_section_area_1)
    } else {
        (params.cross_section_area_1, params.cross_section_area_0)
    };

    let (source_pressure, sink_pressure) = if forward { (p_0, p_1) } else { (p_1, p_0) };

    let (source, sink) = if forward {
        (system_0, system_1)
    } else {
        (system_1, system_0)
    };

    let mut flow = params.dt
        * flow_rate(
            params.k_flow,
            source_pressure,
            sink_pressure,
            source.temperature(),
            sink.temperature(),
            source.heat_capacity_ratio(),
            source.choked_flow_limit,
            source.choked_flow_factor,
        );

    flow = clamp(flow, 0.0, 0.9 * source.n());

    let fraction = if source.n() != 0.0 {
        flow / source.n()
    } else {
        0.0
    };
    let fraction_volume = fraction * source.volume;
    let fraction_mass = fraction * source.mass();

    if flow != 0.0 {
        // Stage 1: the fraction moves from source to sink.
        let e_k_bulk_src0 = source.bulk_kinetic_energy();
        let e_k_bulk_sink0 = sink.bulk_kinetic_energy();

        let e_k_per_mol = source.kinetic_energy_per_mol();
        let source_mix = source.mix;
        sink.gain_n(flow, e_k_per_mol, source_mix);
        source.lose_n(flow, e_k_per_mol);

        let dp_x = source.momentum[0] * fraction;
        let dp_y = source.momentum[1] * fraction;
        source.momentum[0] -= dp_x;
        source.momentum[1] -= dp_y;
        sink.momentum[0] += dp_x;
        sink.momentum[1] += dp_y;

        let e_k_bulk_src1 = source.bulk_kinetic_energy();
        let e_k_bulk_sink1 = sink.bulk_kinetic_energy();

        sink.e_k -= (e_k_bulk_src1 + e_k_bulk_sink1) - (e_k_bulk_src0 + e_k_bulk_sink0);
    }

    let source_mass = source.mass();
    let sink_mass = sink.mass();

    let c_source = source.c();
    let c_sink = sink.c();

    let source_initial_momentum = source.momentum;
    let sink_initial_momentum = sink.momentum;

    // Stage 2: the moving fraction carries momentum through the orifice.
    if sink_cross_section != 0.0 {
        let v = clamp(
            (fraction_volume / sink_cross_section) / params.dt,
            0.0,
            c_sink,
        );
        sink.momentum[0] += v * dx * fraction_mass;
        sink.momentum[1] += v * dy * fraction_mass;
    }

    if source_cross_section != 0.0 && source_mass != 0.0 {
        let v = clamp(
            (fraction_volume / source_cross_section) / params.dt,
            0.0,
            c_source,
        );
        source.momentum[0] += v * dx * fraction_mass;
        source.momentum[1] += v * dy * fraction_mass;
    }

    // Stage 3: pay for the new bulk kinetic energy out of thermal energy.
    if source_mass != 0.0 {
        let inv = 1.0 / source_mass;
        let v0_x = source_initial_momentum[0] * inv;
        let v0_y = source_initial_momentum[1] * inv;
        let v1_x = source.momentum[0] * inv;
        let v1_y = source.momentum[1] * inv;

        source.e_k -= 0.5 * source_mass * (v1_x * v1_x - v0_x * v0_x);
        source.e_k -= 0.5 * source_mass * (v1_y * v1_y - v0_y * v0_y);
    }

    if sink_mass > 0.0 {
        let inv = 1.0 / sink_mass;
        let v0_x = sink_initial_momentum[0] * inv;
        let v0_y = sink_initial_momentum[1] * inv;
        let v1_x = sink.momentum[0] * inv;
        let v1_y = sink.momentum[1] * inv;

        sink.e_k -= 0.5 * sink_mass * (v1_x * v1_x - v0_x * v0_x);
        sink.e_k -= 0.5 * sink_mass * (v1_y * v1_y - v0_y * v0_y);
    }

    if sink.e_k < 0.0 {
        sink.e_k = 0.0;
    }
    if source.e_k < 0.0 {
        source.e_k = 0.0;
    }

    flow * direction
}

/// Convenience: build an atmospheric reservoir.
pub fn atmosphere(volume: f64, extent: f64) -> GasSystem {
    let mut g = GasSystem::default();
    g.initialize(ATM, volume, crate::units::celsius(25.0));
    g.set_geometry(extent, extent, 1.0, 0.0);
    g
}

/// Cylinder cross-section helper.
#[inline]
pub fn bore_surface_area(bore: f64) -> f64 {
    PI * bore * bore / 4.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::units::celsius;

    #[test]
    fn ideal_gas_round_trip() {
        let mut g = GasSystem::default();
        g.initialize(ATM, 0.001, celsius(25.0));
        assert!((g.pressure() - ATM).abs() / ATM < 1e-9);
        assert!((g.temperature() - celsius(25.0)).abs() < 1e-9);
    }

    fn pair(p_a: f64, p_b: f64) -> (GasSystem, GasSystem) {
        let mut a = GasSystem::default();
        a.initialize(p_a, 0.001, celsius(25.0));
        a.set_geometry(0.1, 0.1, 1.0, 0.0);
        let mut b = GasSystem::default();
        b.initialize(p_b, 0.001, celsius(25.0));
        b.set_geometry(0.1, 0.1, 1.0, 0.0);
        (a, b)
    }

    fn params() -> FlowParameters {
        FlowParameters {
            k_flow: k_carb(300.0),
            dt: 1.0 / 10000.0,
            direction_x: 1.0,
            direction_y: 0.0,
            cross_section_area_0: 0.001,
            cross_section_area_1: 0.001,
        }
    }

    #[test]
    fn flow_conserves_mass_between_systems() {
        let (mut a, mut b) = pair(4.0 * ATM, ATM);
        let total_before = a.n() + b.n();

        for _ in 0..100 {
            flow(&params(), &mut a, &mut b);
        }

        let total_after = a.n() + b.n();
        assert!(
            (total_after - total_before).abs() / total_before < 1e-12,
            "moles not conserved: {total_before} -> {total_after}"
        );
    }

    #[test]
    fn flow_runs_from_high_to_low_pressure() {
        let (mut a, mut b) = pair(4.0 * ATM, ATM);
        let forward = flow(&params(), &mut a, &mut b);
        assert!(forward > 0.0, "expected flow a -> b, got {forward}");
        assert!(a.n() < b.n() * 4.0);

        let (mut a, mut b) = pair(ATM, 4.0 * ATM);
        let reverse = flow(&params(), &mut a, &mut b);
        assert!(reverse < 0.0, "expected flow b -> a, got {reverse}");
    }

    #[test]
    fn no_flow_at_equal_pressure() {
        let (mut a, mut b) = pair(ATM, ATM);
        let f = flow(&params(), &mut a, &mut b);
        assert!(f.abs() < 1e-12, "spurious flow {f}");
    }

    #[test]
    fn pressure_difference_shrinks() {
        let (mut a, mut b) = pair(4.0 * ATM, ATM);
        let initial = a.pressure() - b.pressure();

        // Mirrors how the simulation actually runs a control volume: flow, then
        // cap supersonic bulk velocity, then relax momentum.
        for _ in 0..2000 {
            flow(&params(), &mut a, &mut b);
            a.dissipate_excess_velocity();
            b.dissipate_excess_velocity();
            a.update_velocity(params().dt, 0.5);
            b.update_velocity(params().dt, 0.5);
        }

        let remaining = a.pressure() - b.pressure();
        assert!(
            remaining < initial * 0.5,
            "pressure difference barely moved: {initial} -> {remaining}"
        );
    }

    #[test]
    fn compression_raises_pressure() {
        let mut g = GasSystem::default();
        g.initialize(ATM, 0.001, celsius(25.0));
        g.set_volume(0.0001);
        assert!(g.pressure() > 10.0 * ATM);
    }
}
