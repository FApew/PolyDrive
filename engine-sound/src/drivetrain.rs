//! Vehicle and gearbox.
//!
//! The original couples the engine to a vehicle through a clutch constraint in
//! its rigid-body solver. With that solver gone, this is a compact stand-in: the
//! car carries its own speed, and a clutch passes torque between the two
//! according to how much they disagree.
//!
//! A rigid coupling would have been less code, but it cannot pull away from
//! rest — engine speed would be nailed to road speed, so engaging first at a
//! standstill stalls the engine — and a gearchange would teleport the car
//! instead of dropping the revs. A slipping clutch gets both right for the
//! price of one extra state variable, and it is what gears do to the sound:
//! first revs out in a second, top gear leans on the engine and holds it down.

use crate::units::PI;

/// Air density at sea level, kg/m³.
const AIR_DENSITY: f64 = 1.225;

#[derive(Clone, Debug)]
pub struct VehicleConfig {
    /// Kerb mass plus driver, kg.
    pub mass: f64,
    pub drag_coefficient: f64,
    /// Frontal area, m².
    pub frontal_area: f64,
    pub tire_radius: f64,
    /// Constant rolling drag, N.
    pub rolling_resistance: f64,
    /// Final drive ratio.
    pub final_drive: f64,
    /// Gear ratios, first to top.
    pub gear_ratios: Vec<f64>,
    /// How much of the drive is lost to the transmission, 0..1.
    pub driveline_efficiency: f64,
    /// Most torque the clutch can pass, N·m.
    pub max_clutch_torque: f64,
    /// Torque passed per rad/s of slip. High enough that a settled clutch
    /// barely slips, low enough to integrate without fuss.
    pub clutch_stiffness: f64,
}

impl Default for VehicleConfig {
    fn default() -> Self {
        // An unremarkable mid-size car, so a preset has something to drive
        // without the caller having to describe one.
        Self {
            mass: 1400.0,
            drag_coefficient: 0.32,
            frontal_area: 2.2,
            tire_radius: 0.32,
            rolling_resistance: 250.0,
            final_drive: 3.9,
            gear_ratios: vec![3.35, 2.06, 1.4, 1.0, 0.82],
            driveline_efficiency: 0.9,
            max_clutch_torque: 500.0,
            clutch_stiffness: 400.0,
        }
    }
}

impl VehicleConfig {
    pub fn gear_count(&self) -> usize {
        self.gear_ratios.len()
    }

    /// Crank revolutions per wheel revolution in the given gear.
    pub fn total_ratio(&self, gear: usize) -> Option<f64> {
        let ratio = self.gear_ratios.get(gear)? * self.final_drive;
        (ratio.abs() > 1e-6).then_some(ratio)
    }

    /// Road speed in m/s for a crank speed in rad/s.
    pub fn speed(&self, crank_speed: f64, gear: Option<usize>) -> f64 {
        match gear.and_then(|g| self.total_ratio(g)) {
            Some(ratio) => (crank_speed.abs() / ratio) * self.tire_radius,
            None => 0.0,
        }
    }

    /// Road speed matching a crank speed, or `None` in neutral — where the car
    /// keeps whatever speed it already had.
    pub fn speed_for(&self, crank_speed: f64, gear: Option<usize>) -> Option<f64> {
        gear.and_then(|g| self.total_ratio(g))
            .map(|ratio| (crank_speed.abs() / ratio) * self.tire_radius)
    }

    /// Crank speed in rad/s that a road speed corresponds to.
    pub fn crank_speed(&self, road_speed: f64, gear: Option<usize>) -> Option<f64> {
        let ratio = gear.and_then(|g| self.total_ratio(g))?;
        Some((road_speed / self.tire_radius) * ratio)
    }

    /// Drag plus rolling resistance at a road speed, N. Always opposes motion.
    pub fn resistance(&self, road_speed: f64) -> f64 {
        let drag =
            0.5 * AIR_DENSITY * self.drag_coefficient * self.frontal_area * road_speed * road_speed;
        drag + self.rolling_resistance
    }

    /// Torque the clutch passes from engine to wheels, N·m at the crank.
    ///
    /// Positive means the engine is driving the car; negative is the car
    /// driving the engine, which is engine braking on a closed throttle.
    pub fn clutch_torque(&self, engine_speed: f64, road_speed: f64, gear: Option<usize>) -> f64 {
        let Some(ratio) = gear.and_then(|g| self.total_ratio(g)) else {
            return 0.0;
        };

        let matched = (road_speed / self.tire_radius) * ratio;
        let slip = engine_speed - matched;
        (self.clutch_stiffness * slip).clamp(-self.max_clutch_torque, self.max_clutch_torque)
    }

    /// Advances road speed by one step, given the torque the clutch is passing.
    pub fn step(&self, road_speed: f64, clutch_torque: f64, gear: Option<usize>, dt: f64) -> f64 {
        let efficiency = self.driveline_efficiency.clamp(0.05, 1.0);
        let drive = match gear.and_then(|g| self.total_ratio(g)) {
            Some(ratio) => clutch_torque * ratio * efficiency / self.tire_radius,
            None => 0.0,
        };

        let resistance = self.resistance(road_speed);
        // Resistance can slow the car but not drag it backwards.
        let net = if road_speed > 0.0 {
            drive - resistance
        } else {
            (drive - resistance).max(0.0)
        };

        (road_speed + (net / self.mass.max(1.0)) * dt).max(0.0)
    }

    /// Engine speed in rpm at a road speed in km/h, for a gearing sanity check.
    pub fn rpm_at(&self, kph: f64, gear: usize) -> Option<f64> {
        let crank = self.crank_speed(kph / 3.6, Some(gear))?;
        Some(crank * 60.0 / (2.0 * PI))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speed_and_crank_speed_are_inverses() {
        let v = VehicleConfig::default();
        for gear in 0..v.gear_count() {
            let crank = 300.0;
            let speed = v.speed(crank, Some(gear));
            let back = v.crank_speed(speed, Some(gear)).unwrap();
            assert!((back - crank).abs() < 1e-9, "gear {gear}");
        }
        assert_eq!(v.speed(300.0, None), 0.0);
    }

    #[test]
    fn gearing_gives_plausible_road_speeds() {
        let v = VehicleConfig::default();
        // Top gear at a motorway cruise should sit in the low thousands.
        let rpm = v.rpm_at(100.0, v.gear_count() - 1).unwrap();
        assert!((1500.0..3500.0).contains(&rpm), "{rpm} rpm at 100 km/h");

        // First gear at walking pace should be near idle, not at the limiter.
        let rpm = v.rpm_at(10.0, 0).unwrap();
        assert!((500.0..2000.0).contains(&rpm), "{rpm} rpm at 10 km/h");
    }

    #[test]
    fn resistance_grows_with_speed() {
        let v = VehicleConfig::default();
        assert!(v.resistance(30.0) > v.resistance(10.0));
        // Standing still, only rolling resistance is left.
        assert!((v.resistance(0.0) - v.rolling_resistance).abs() < 1e-9);
    }

    #[test]
    fn the_clutch_drives_when_the_engine_is_faster_and_brakes_when_it_is_not() {
        let v = VehicleConfig::default();
        // Engine spinning, car stopped: the clutch pulls the car along.
        assert!(v.clutch_torque(100.0, 0.0, Some(0)) > 0.0);
        // Car rolling faster than the engine wants: engine braking.
        assert!(v.clutch_torque(50.0, 30.0, Some(4)) < 0.0);
        // Matched: nothing passes.
        let matched = v.crank_speed(20.0, Some(2)).unwrap();
        assert!(v.clutch_torque(matched, 20.0, Some(2)).abs() < 1e-9);
        // Neutral passes nothing at all.
        assert_eq!(v.clutch_torque(400.0, 0.0, None), 0.0);
    }

    #[test]
    fn the_clutch_cannot_pass_more_than_it_is_rated_for() {
        let v = VehicleConfig::default();
        let huge = v.clutch_torque(10_000.0, 0.0, Some(0));
        assert!((huge - v.max_clutch_torque).abs() < 1e-9);
        let huge_negative = v.clutch_torque(0.0, 10_000.0, Some(0));
        assert!((huge_negative + v.max_clutch_torque).abs() < 1e-9);
    }

    #[test]
    fn the_car_pulls_away_coasts_down_and_never_rolls_backwards() {
        let v = VehicleConfig::default();
        let dt = 1.0 / 1000.0;

        // In gear with the clutch driving: it accelerates.
        let mut speed = 0.0;
        for _ in 0..1000 {
            speed = v.step(speed, v.max_clutch_torque, Some(0), dt);
        }
        assert!(speed > 1.0, "did not pull away: {speed} m/s");

        // Out of gear: it coasts down, and stops rather than reversing.
        let mut coasting = speed;
        for _ in 0..60_000 {
            coasting = v.step(coasting, 0.0, None, dt);
        }
        assert!(coasting < speed, "did not coast down");
        assert!(coasting >= 0.0, "rolled backwards: {coasting}");
    }

    #[test]
    fn an_empty_or_silly_gearbox_is_treated_as_neutral() {
        let mut v = VehicleConfig {
            gear_ratios: vec![],
            ..Default::default()
        };
        assert_eq!(v.total_ratio(0), None);
        assert_eq!(v.clutch_torque(300.0, 0.0, Some(0)), 0.0);
        assert_eq!(
            v.step(10.0, 500.0, Some(0), 0.01),
            v.step(10.0, 0.0, None, 0.01)
        );

        v.gear_ratios = vec![0.0];
        assert_eq!(v.total_ratio(0), None, "a zero ratio is not a gear");
    }
}
