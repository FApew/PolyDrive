//! The audio filter chain.
//!
//! Ports of `convolution_filter`, `low_pass_filter`,
//! `butterworth_low_pass_filter`, `derivative_filter`, `jitter_filter`,
//! `leveling_filter` and `delay_filter`.

use crate::units::PI;
use std::collections::VecDeque;

/// Small deterministic PRNG. The C++ code uses `rand()` /
/// `std::default_random_engine`; the exact sequence is irrelevant, only the
/// distribution is.
#[derive(Clone, Debug)]
pub struct Rng(u32);

impl Default for Rng {
    fn default() -> Self {
        Self(0x2545_F491)
    }
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Self(if seed == 0 { 0x2545_F491 } else { seed })
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    /// Uniform in `[0, 1)`.
    #[inline]
    pub fn unit(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / (1u32 << 24) as f32
    }

    /// Uniform in `[-1, 1)`.
    #[inline]
    pub fn bipolar(&mut self) -> f32 {
        2.0 * self.unit() - 1.0
    }
}

/// One-pole RC low pass.
#[derive(Clone, Debug)]
pub struct LowPassFilter {
    y: f32,
    rc: f32,
    pub dt: f32,
}

impl Default for LowPassFilter {
    fn default() -> Self {
        Self {
            y: 0.0,
            rc: 0.0,
            dt: 1.0 / 44100.0,
        }
    }
}

impl LowPassFilter {
    pub fn set_cutoff_frequency(&mut self, f: f32) {
        self.rc = 1.0 / (f * 2.0 * PI as f32);
    }

    #[inline]
    pub fn f(&mut self, sample: f32) -> f32 {
        let alpha = self.dt / (self.rc + self.dt);
        self.y = alpha * sample + (1.0 - alpha) * self.y;
        self.y
    }
}

/// Fourth-order Butterworth low pass (direct form I).
///
/// `x[0]` is `x[n-1]`, `x[3]` is `x[n-4]`; same for `y`.
#[derive(Clone, Debug, Default)]
pub struct ButterworthLowPassFilter {
    y: [f64; 4],
    x: [f64; 4],
    a: [f64; 5],
    f_4: f64,
}

impl ButterworthLowPassFilter {
    pub fn set_cutoff_frequency(&mut self, f_c: f64, sample_rate: f64) {
        let f = (PI * f_c / sample_rate).tan();
        let f_2 = f * f;
        let f_3 = f_2 * f;
        let f_4 = f_2 * f_2;
        let m = -2.0 * (5.0 * PI / 8.0).cos();
        let n = -2.0 * (7.0 * PI / 8.0).cos();

        let a0 = 1.0 + (m + n) * f + (2.0 + n * m) * f_2 + (m + n) * f_3 + f_4;
        self.a[0] = a0;
        self.a[1] = (-4.0 - 2.0 * (n + m) * f + 2.0 * (m + n) * f_3 + 4.0 * f_4) / a0;
        self.a[2] = (6.0 - 2.0 * (2.0 + m * n) * f_2 + 6.0 * f_4) / a0;
        self.a[3] = (-4.0 + 2.0 * (m + n) * f - 2.0 * (m + n) * f_3 + 4.0 * f_4) / a0;
        self.a[4] = (1.0 - (n + m) * f + (2.0 + m * n) * f_2 - (m + n) * f_3 + f_4) / a0;

        self.f_4 = f_4;
    }

    #[inline]
    pub fn f(&mut self, sample: f64) -> f64 {
        let n = self.f_4 / self.a[0]
            * (sample + 4.0 * self.x[0] + 6.0 * self.x[1] + 4.0 * self.x[2] + self.x[3]);
        let d = -self.a[1] * self.y[0]
            - self.a[2] * self.y[1]
            - self.a[3] * self.y[2]
            - self.a[4] * self.y[3];
        let y = n + d;

        self.x[3] = self.x[2];
        self.x[2] = self.x[1];
        self.x[1] = self.x[0];
        self.x[0] = sample;

        self.y[3] = self.y[2];
        self.y[2] = self.y[1];
        self.y[1] = self.y[0];
        self.y[0] = y;

        y
    }

    #[inline]
    pub fn f32(&mut self, sample: f32) -> f32 {
        self.f(sample as f64) as f32
    }
}

/// First difference over `dt`. Supplies the high-frequency "edge" content that
/// gets mixed in via `dF_F_mix`.
#[derive(Clone, Debug)]
pub struct DerivativeFilter {
    previous: f32,
    pub dt: f32,
}

impl Default for DerivativeFilter {
    fn default() -> Self {
        Self {
            previous: 0.0,
            dt: 1.0,
        }
    }
}

impl DerivativeFilter {
    #[inline]
    pub fn f(&mut self, sample: f32) -> f32 {
        let temp = self.previous;
        self.previous = sample;
        (sample - temp) / self.dt
    }
}

/// Randomly modulated fractional delay. Breaks up the perfect periodicity of
/// the simulated cylinder events so the result does not sound synthetic.
#[derive(Clone, Debug, Default)]
pub struct JitterFilter {
    noise_filter: ButterworthLowPassFilter,
    jitter_scale: f32,
    max_jitter: usize,
    offset: usize,
    history: Vec<f32>,
    rng: Rng,
}

impl JitterFilter {
    pub fn initialize(&mut self, max_jitter: usize, cutoff_frequency: f64, audio_frequency: f64) {
        self.max_jitter = max_jitter;
        self.history = vec![0.0; max_jitter];
        self.offset = 0;
        self.noise_filter
            .set_cutoff_frequency(cutoff_frequency, audio_frequency);
    }

    pub fn set_jitter_scale(&mut self, s: f32) {
        self.jitter_scale = s;
    }

    #[inline]
    pub fn f(&mut self, sample: f32) -> f32 {
        if self.max_jitter == 0 {
            return sample;
        }

        self.history[self.offset] = sample;
        self.offset += 1;
        if self.offset >= self.max_jitter {
            self.offset = 0;
        }

        let max = (self.max_jitter - 1) as f32;
        let raw = self.rng.unit() * max;
        let s = self.noise_filter.f32(raw * self.jitter_scale);

        let s_i_0 = s.floor().clamp(0.0, max);
        let s_i_1 = s.ceil().clamp(0.0, max);
        let s_frac = s - s_i_0;

        let i_0 = s_i_0 as usize + self.offset;
        let i_1 = s_i_1 as usize + self.offset;

        let v0 = self.history[if i_0 >= self.max_jitter {
            i_0 - self.max_jitter
        } else {
            i_0
        }];
        let v1 = self.history[if i_1 >= self.max_jitter {
            i_1 - self.max_jitter
        } else {
            i_1
        }];

        v1 * s_frac + v0 * (1.0 - s_frac)
    }
}

/// In-place iterative radix-2 FFT with precomputed twiddles.
#[derive(Clone, Debug)]
struct Fft {
    n: usize,
    /// Twiddle factors for the forward transform, one per butterfly stage span.
    cos: Vec<f32>,
    sin: Vec<f32>,
    rev: Vec<u32>,
}

impl Fft {
    fn new(n: usize) -> Self {
        debug_assert!(n.is_power_of_two() && n >= 2);

        let mut cos = Vec::with_capacity(n / 2);
        let mut sin = Vec::with_capacity(n / 2);
        for i in 0..n / 2 {
            let angle = -2.0 * PI * i as f64 / n as f64;
            cos.push(angle.cos() as f32);
            sin.push(angle.sin() as f32);
        }

        let bits = n.trailing_zeros();
        let rev = (0..n)
            .map(|i| (i as u32).reverse_bits() >> (32 - bits))
            .collect();

        Self { n, cos, sin, rev }
    }

    fn transform(&self, re: &mut [f32], im: &mut [f32], inverse: bool) {
        let n = self.n;

        for i in 0..n {
            let j = self.rev[i] as usize;
            if i < j {
                re.swap(i, j);
                im.swap(i, j);
            }
        }

        let mut len = 2;
        while len <= n {
            let step = n / len;
            let half = len / 2;
            let mut base = 0;
            while base < n {
                for k in 0..half {
                    let t = k * step;
                    let wr = self.cos[t];
                    let wi = if inverse { -self.sin[t] } else { self.sin[t] };

                    let i0 = base + k;
                    let i1 = i0 + half;

                    let xr = re[i1] * wr - im[i1] * wi;
                    let xi = re[i1] * wi + im[i1] * wr;

                    re[i1] = re[i0] - xr;
                    im[i1] = im[i0] - xi;
                    re[i0] += xr;
                    im[i0] += xi;
                }
                base += len;
            }
            len <<= 1;
        }

        if inverse {
            let scale = 1.0 / n as f32;
            for i in 0..n {
                re[i] *= scale;
                im[i] *= scale;
            }
        }
    }
}

/// Uniformly-partitioned overlap-save convolution.
///
/// The original convolves directly, which at its 10 000-tap ceiling is ~440
/// million multiply-adds per second of audio per channel — fine for a desktop
/// application with the whole machine to itself, far too much for an audio
/// worklet. This computes the same convolution in the frequency domain, so a
/// full-length impulse response costs roughly what a 200-tap direct filter
/// would.
///
/// The one observable difference is `block` samples of latency (a few
/// milliseconds), which for engine noise is inaudible.
#[derive(Clone, Debug)]
struct PartitionedConvolution {
    block: usize,
    fft: Fft,
    /// Spectrum of each impulse response partition.
    ir_re: Vec<Vec<f32>>,
    ir_im: Vec<Vec<f32>>,
    /// Frequency-domain delay line of past input segments.
    fdl_re: Vec<Vec<f32>>,
    fdl_im: Vec<Vec<f32>>,
    fdl_pos: usize,

    prev_input: Vec<f32>,
    input: Vec<f32>,
    output: Vec<f32>,
    pos: usize,

    acc_re: Vec<f32>,
    acc_im: Vec<f32>,
    work_re: Vec<f32>,
    work_im: Vec<f32>,
}

impl PartitionedConvolution {
    fn new(impulse_response: &[f32], block: usize) -> Self {
        let m = block * 2;
        let fft = Fft::new(m);
        let partitions = impulse_response.len().div_ceil(block).max(1);

        let mut ir_re = Vec::with_capacity(partitions);
        let mut ir_im = Vec::with_capacity(partitions);
        for p in 0..partitions {
            let mut re = vec![0.0f32; m];
            let mut im = vec![0.0f32; m];
            let start = p * block;
            let end = (start + block).min(impulse_response.len());
            re[..end - start].copy_from_slice(&impulse_response[start..end]);
            fft.transform(&mut re, &mut im, false);
            ir_re.push(re);
            ir_im.push(im);
        }

        Self {
            block,
            fft,
            ir_re,
            ir_im,
            fdl_re: vec![vec![0.0; m]; partitions],
            fdl_im: vec![vec![0.0; m]; partitions],
            fdl_pos: 0,
            prev_input: vec![0.0; block],
            input: vec![0.0; block],
            output: vec![0.0; block],
            pos: 0,
            acc_re: vec![0.0; m],
            acc_im: vec![0.0; m],
            work_re: vec![0.0; m],
            work_im: vec![0.0; m],
        }
    }

    #[inline]
    fn f(&mut self, sample: f32) -> f32 {
        let i = self.pos;
        self.input[i] = sample;
        let y = self.output[i];

        self.pos += 1;
        if self.pos == self.block {
            self.pos = 0;
            self.process_block();
        }

        y
    }

    fn process_block(&mut self) {
        let m = self.block * 2;

        // Overlap-save: transform [previous block | current block].
        self.work_re[..self.block].copy_from_slice(&self.prev_input);
        self.work_re[self.block..].copy_from_slice(&self.input);
        self.work_im.fill(0.0);
        self.fft
            .transform(&mut self.work_re, &mut self.work_im, false);

        self.fdl_re[self.fdl_pos].copy_from_slice(&self.work_re);
        self.fdl_im[self.fdl_pos].copy_from_slice(&self.work_im);

        self.acc_re.fill(0.0);
        self.acc_im.fill(0.0);

        let partitions = self.ir_re.len();
        for p in 0..partitions {
            let slot = (self.fdl_pos + partitions - p) % partitions;
            let (xr, xi) = (&self.fdl_re[slot], &self.fdl_im[slot]);
            let (hr, hi) = (&self.ir_re[p], &self.ir_im[p]);
            for k in 0..m {
                self.acc_re[k] += xr[k] * hr[k] - xi[k] * hi[k];
                self.acc_im[k] += xr[k] * hi[k] + xi[k] * hr[k];
            }
        }

        self.fft.transform(&mut self.acc_re, &mut self.acc_im, true);

        // Discard the wrapped first half; the second half is the valid output.
        self.output.copy_from_slice(&self.acc_re[self.block..]);

        self.prev_input.copy_from_slice(&self.input);
        self.fdl_pos = (self.fdl_pos + 1) % partitions;
    }
}

/// Convolution against a recorded exhaust impulse response. This is what turns
/// a raw pressure pulse train into a car.
///
/// Short responses use a direct FIR (no latency); longer ones switch to
/// partitioned FFT convolution.
#[derive(Clone, Debug, Default)]
pub struct ConvolutionFilter {
    // Direct path.
    shift_register: Vec<f32>,
    shift_offset: usize,
    impulse_response: Vec<f32>,
    // Frequency-domain path.
    partitioned: Option<PartitionedConvolution>,
}

/// Responses at least this long are convolved with the FFT path.
const FFT_THRESHOLD: usize = 256;
/// Partition size: 128 samples is ~3 ms at 44.1 kHz.
const FFT_BLOCK: usize = 128;

impl ConvolutionFilter {
    /// Allocates a response of `samples` taps, zero-filled. Fill it via
    /// [`Self::impulse_response_mut`] then call [`Self::commit`].
    pub fn initialize(&mut self, samples: usize) {
        self.shift_register = vec![0.0; samples];
        self.impulse_response = vec![0.0; samples];
        self.shift_offset = 0;
        self.partitioned = None;
    }

    /// Prepares the chosen convolution strategy. Must be called after writing
    /// the impulse response.
    pub fn commit(&mut self) {
        self.partitioned = if self.impulse_response.len() >= FFT_THRESHOLD {
            Some(PartitionedConvolution::new(
                &self.impulse_response,
                FFT_BLOCK,
            ))
        } else {
            None
        };
    }

    pub fn sample_count(&self) -> usize {
        self.impulse_response.len()
    }

    pub fn impulse_response_mut(&mut self) -> &mut [f32] {
        &mut self.impulse_response
    }

    #[inline]
    pub fn f(&mut self, sample: f32) -> f32 {
        if let Some(p) = self.partitioned.as_mut() {
            return p.f(sample);
        }

        let n = self.impulse_response.len();
        if n == 0 {
            return sample;
        }

        self.shift_register[self.shift_offset] = sample;

        let split = n - self.shift_offset;
        let mut result = 0.0f32;

        // Head: impulse[0..split] against shift[offset..n]
        let ir = &self.impulse_response[..split];
        let sr = &self.shift_register[self.shift_offset..];
        for i in 0..split {
            result += ir[i] * sr[i];
        }

        // Tail: impulse[split..n] against shift[0..offset]
        let ir = &self.impulse_response[split..];
        let sr = &self.shift_register[..self.shift_offset];
        for i in 0..self.shift_offset {
            result += ir[i] * sr[i];
        }

        self.shift_offset = (self.shift_offset + n - 1) % n;

        result
    }
}

/// Peak-following auto gain. Keeps the output near `target` regardless of RPM
/// or cylinder count.
#[derive(Clone, Debug)]
pub struct LevelingFilter {
    peak: f32,
    attenuation: f32,
    pub max_level: f32,
    pub min_level: f32,
    pub target: f32,
}

impl Default for LevelingFilter {
    fn default() -> Self {
        Self {
            peak: 30000.0,
            attenuation: 1.0,
            max_level: 1.0,
            min_level: 0.0,
            target: 30000.0,
        }
    }
}

impl LevelingFilter {
    pub fn new(target: f32, min_level: f32, max_level: f32) -> Self {
        Self {
            peak: target,
            attenuation: 1.0,
            max_level,
            min_level,
            target,
        }
    }

    #[inline]
    pub fn f(&mut self, sample: f32) -> f32 {
        self.peak *= 0.999;
        if sample.abs() > self.peak {
            self.peak = sample.abs();
        }

        if self.peak == 0.0 {
            return 0.0;
        }

        let raw = self.target / self.peak;
        let attenuation = raw.clamp(self.min_level, self.max_level);
        self.attenuation = 0.9 * self.attenuation + 0.1 * attenuation;

        sample * self.attenuation
    }

    pub fn attenuation(&self) -> f32 {
        self.attenuation
    }
}

/// Fixed integer delay line. Used to give each cylinder's exhaust pulse the
/// correct acoustic travel time down its header primary.
#[derive(Clone, Debug, Default)]
pub struct DelayFilter {
    latency_samples: usize,
    history: VecDeque<f64>,
}

impl DelayFilter {
    pub fn initialize(&mut self, delay: f64, audio_frequency: f64) {
        let samples = (delay * audio_frequency).round().max(0.0) as usize;
        self.latency_samples = samples;
        self.history = VecDeque::with_capacity(samples + 32);
    }

    #[inline]
    pub fn f(&mut self, sample: f64) -> f64 {
        self.history.push_back(sample);
        if self.history.len() <= self.latency_samples {
            0.0
        } else {
            self.history.pop_front().unwrap_or(0.0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn convolution_reproduces_impulse_response() {
        let mut c = ConvolutionFilter::default();
        c.initialize(4);
        c.impulse_response_mut()
            .copy_from_slice(&[1.0, 2.0, 3.0, 4.0]);
        c.commit();

        let out: Vec<f32> = [1.0f32, 0.0, 0.0, 0.0, 0.0, 0.0]
            .iter()
            .map(|&s| c.f(s))
            .collect();

        assert_eq!(&out[..4], &[1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn fft_matches_direct_convolution() {
        let mut rng = Rng::new(7);
        let ir: Vec<f32> = (0..1000).map(|_| rng.bipolar()).collect();
        let input: Vec<f32> = (0..4000).map(|_| rng.bipolar()).collect();

        // Direct reference.
        let mut direct = ConvolutionFilter::default();
        direct.initialize(ir.len());
        direct.impulse_response_mut().copy_from_slice(&ir);
        // Deliberately skip commit() so the direct path is used.
        let reference: Vec<f32> = input.iter().map(|&s| direct.f(s)).collect();

        let mut fast = ConvolutionFilter::default();
        fast.initialize(ir.len());
        fast.impulse_response_mut().copy_from_slice(&ir);
        fast.commit();
        let actual: Vec<f32> = input.iter().map(|&s| fast.f(s)).collect();

        // The FFT path lags by one partition.
        let lag = FFT_BLOCK;
        let mut max_err = 0.0f32;
        for i in 0..reference.len() - lag {
            max_err = max_err.max((reference[i] - actual[i + lag]).abs());
        }
        assert!(max_err < 1e-2, "max error {max_err}");
    }

    #[test]
    fn fft_round_trips() {
        let n = 64;
        let fft = Fft::new(n);
        let mut rng = Rng::new(3);
        let re0: Vec<f32> = (0..n).map(|_| rng.bipolar()).collect();
        let mut re = re0.clone();
        let mut im = vec![0.0f32; n];

        fft.transform(&mut re, &mut im, false);
        fft.transform(&mut re, &mut im, true);

        for i in 0..n {
            assert!((re[i] - re0[i]).abs() < 1e-4, "index {i}");
            assert!(im[i].abs() < 1e-4);
        }
    }

    #[test]
    fn delay_filter_delays() {
        let mut d = DelayFilter::default();
        d.initialize(3.0 / 100.0, 100.0);
        assert_eq!(d.f(1.0), 0.0);
        assert_eq!(d.f(2.0), 0.0);
        assert_eq!(d.f(3.0), 0.0);
        assert_eq!(d.f(4.0), 1.0);
    }

    #[test]
    fn butterworth_passes_dc_and_blocks_nyquist() {
        let mut b = ButterworthLowPassFilter::default();
        b.set_cutoff_frequency(1000.0, 44100.0);
        let mut dc = 0.0;
        for _ in 0..2000 {
            dc = b.f(1.0);
        }
        assert!((dc - 1.0).abs() < 1e-3, "dc gain {dc}");

        let mut b = ButterworthLowPassFilter::default();
        b.set_cutoff_frequency(1000.0, 44100.0);
        let mut peak: f64 = 0.0;
        for i in 0..2000 {
            let v = b.f(if i % 2 == 0 { 1.0 } else { -1.0 });
            if i > 1000 {
                peak = peak.max(v.abs());
            }
        }
        assert!(peak < 1e-3, "nyquist leakage {peak}");
    }

    #[test]
    fn leveling_filter_converges_to_target() {
        let mut l = LevelingFilter::new(30000.0, 1e-5, 1.9);
        let mut last = 0.0;
        for i in 0..200000 {
            let s = 1000.0 * (i as f32 * 0.05).sin();
            last = l.f(s);
        }
        let _ = last;
        assert!(l.attenuation() > 1.5);
    }
}
