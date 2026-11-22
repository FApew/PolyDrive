//! Sampled 1-D function with triangle-filtered interpolation.
//!
//! Port of `src/function.cpp`. Only `sampleTriangle` is used by the sound
//! algorithm, so the gaussian path is omitted.

#[derive(Clone, Debug, Default)]
pub struct Function {
    x: Vec<f64>,
    y: Vec<f64>,
    filter_radius: f64,
    input_scale: f64,
    output_scale: f64,
}

impl Function {
    pub fn new(filter_radius: f64) -> Self {
        Self {
            x: Vec::new(),
            y: Vec::new(),
            filter_radius,
            input_scale: 1.0,
            output_scale: 1.0,
        }
    }

    pub fn from_samples(filter_radius: f64, samples: &[(f64, f64)]) -> Self {
        let mut f = Self::new(filter_radius);
        for &(x, y) in samples {
            f.add_sample(x, y);
        }
        f
    }

    pub fn set_input_scale(&mut self, s: f64) {
        self.input_scale = s;
    }

    pub fn set_output_scale(&mut self, s: f64) {
        self.output_scale = s;
    }

    pub fn set_filter_radius(&mut self, r: f64) {
        self.filter_radius = r;
    }

    pub fn len(&self) -> usize {
        self.x.len()
    }

    pub fn is_empty(&self) -> bool {
        self.x.is_empty()
    }

    /// Inserts a sample, keeping the sample list sorted by `x`.
    pub fn add_sample(&mut self, x: f64, y: f64) {
        let closest = match self.closest_sample(x) {
            Some(c) => c,
            None => {
                self.x.push(x);
                self.y.push(y);
                return;
            }
        };

        let index = if x < self.x[closest] {
            closest
        } else {
            closest + 1
        };
        self.x.insert(index, x);
        self.y.insert(index, y);
    }

    /// Triangle-filtered sample. This is the only interpolation the simulation
    /// uses (valve lift, port flow, ignition timing, flame speed).
    pub fn sample_triangle(&self, x: f64) -> f64 {
        let x = x * self.input_scale;
        let n = self.x.len();
        if n == 0 {
            return 0.0;
        }
        if x >= self.x[n - 1] {
            return self.y[n - 1] * self.output_scale;
        }
        if x <= self.x[0] {
            return self.y[0] * self.output_scale;
        }

        let closest = self.closest_sample(x).unwrap();

        let mut sum = 0.0;
        let mut total_weight = 0.0;

        let mut i = closest as isize;
        while i >= 0 {
            let iu = i as usize;
            if self.x[iu] <= x {
                if (x - self.x[iu]).abs() > self.filter_radius {
                    break;
                }
                let w = self.triangle(self.x[iu] - x);
                sum += w * self.y[iu];
                total_weight += w;
            }
            i -= 1;
        }

        for i in closest..n {
            if self.x[i] <= x {
                continue;
            }
            if (self.x[i] - x).abs() > self.filter_radius {
                break;
            }
            let w = self.triangle(self.x[i] - x);
            sum += w * self.y[i];
            total_weight += w;
        }

        if total_weight != 0.0 {
            sum * self.output_scale / total_weight
        } else {
            0.0
        }
    }

    #[inline]
    fn triangle(&self, x: f64) -> f64 {
        (self.filter_radius - x.abs()) / self.filter_radius
    }

    fn closest_sample(&self, x: f64) -> Option<usize> {
        let n = self.x.len();
        if n == 0 {
            return None;
        }
        if x.is_nan() {
            return Some(0);
        }

        let mut l = 0usize;
        let mut r = n - 1;
        if x <= self.x[l] {
            return Some(l);
        }
        if x >= self.x[r] {
            return Some(r);
        }

        while l + 1 < r {
            let m = (l + r) / 2;
            if x > self.x[m] {
                l = m;
            } else if x < self.x[m] {
                r = m;
            } else {
                return Some(m);
            }
        }

        Some(if x - self.x[l] < self.x[r] - x { l } else { r })
    }
}

/// Generates a harmonic cam lobe profile.
///
/// Port of `GenerateHarmonicCamLobeNode` in `scripting/include/actions.h`.
/// `duration_at_50_thou` and `lift` are in radians / metres respectively.
pub fn harmonic_cam_lobe(
    duration_at_50_thou: f64,
    gamma: f64,
    lift: f64,
    steps: usize,
) -> Function {
    let angle = duration_at_50_thou / 4.0;
    let s = (2.0 * crate::units::THOU * 50.0 / lift).powf(1.0 / gamma) - 1.0;
    let k = s.clamp(-1.0, 1.0).acos() / angle;
    let extents = crate::units::PI / k;
    let step = extents / (steps as f64 - 5.0);

    let mut f = Function::new(step);
    for i in 0..steps {
        if i == 0 {
            f.add_sample(0.0, lift);
        } else {
            let x = i as f64 * step;
            let l = if x >= extents {
                0.0
            } else {
                lift * (0.5 + 0.5 * (k * x).cos()).powf(gamma)
            };
            f.add_sample(x, l);
            f.add_sample(-x, l);
        }
    }
    f
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_are_sorted_and_interpolated() {
        let f = Function::from_samples(1.0, &[(0.0, 0.0), (2.0, 2.0), (1.0, 1.0)]);
        assert!((f.sample_triangle(0.5) - 0.5).abs() < 1e-9);
        assert!((f.sample_triangle(-5.0) - 0.0).abs() < 1e-9);
        assert!((f.sample_triangle(5.0) - 2.0).abs() < 1e-9);
    }

    #[test]
    fn cam_lobe_peaks_at_zero() {
        let lobe = harmonic_cam_lobe(
            230.0 * crate::units::DEG,
            0.9,
            551.0 * crate::units::THOU,
            256,
        );
        let peak = lobe.sample_triangle(0.0);
        assert!(peak > 0.9 * 551.0 * crate::units::THOU);
        assert!(lobe.sample_triangle(crate::units::PI) < peak * 1e-3);
    }
}
