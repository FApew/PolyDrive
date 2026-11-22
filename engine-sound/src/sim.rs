//! Top-level driver: runs the engine and pulls audio out of the synthesizer.
//!
//! Ports `PistonEngineSimulator::writeToSynthesizer` and the simulate/render
//! loop from `Simulator`.

use crate::config::EngineConfig;
use crate::engine::Engine;
use crate::filters::DelayFilter;
use crate::synth::{AudioParameters, Synthesizer, SynthesizerParameters};
use crate::units::{ATM, PI};

const SPEED_OF_SOUND: f64 = 343.0;

pub struct SoundEngine {
    pub engine: Engine,
    pub synth: Synthesizer,
    /// One per cylinder: acoustic travel time from the valve to the tailpipe.
    delay_filters: Vec<DelayFilter>,
    staging: Vec<f64>,
    dt: f64,
}

impl SoundEngine {
    pub fn new(cfg: EngineConfig, audio_sample_rate: f64) -> Self {
        let simulation_frequency = cfg.simulation_frequency;
        let audio = cfg.audio;
        let exhaust_count = cfg.exhausts.len().max(1);

        let engine = Engine::new(cfg);

        let mut delay_filters = Vec::with_capacity(engine.cylinder_count());
        for i in 0..engine.cylinder_count() {
            let cylinder = &engine.cfg.cylinders[i];
            let exhaust = &engine.exhausts[cylinder.exhaust.min(exhaust_count - 1)];
            let exhaust_length = cylinder.header_primary_length + exhaust.length();
            let mut filter = DelayFilter::default();
            filter.initialize(exhaust_length / SPEED_OF_SOUND, simulation_frequency);
            delay_filters.push(filter);
        }

        let mut synth = Synthesizer::new(&SynthesizerParameters {
            input_channel_count: exhaust_count,
            input_sample_rate: simulation_frequency,
            audio_sample_rate,
            initial_audio_parameters: audio,
            ..Default::default()
        });

        let default_ir = default_impulse_response(audio_sample_rate, 0.05);
        for channel in 0..exhaust_count {
            synth.set_impulse_response(channel, &default_ir, 1.0);
        }

        Self {
            engine,
            synth,
            delay_filters,
            staging: vec![0.0; exhaust_count],
            dt: 1.0 / simulation_frequency,
        }
    }

    pub fn from_preset(preset: crate::config::Preset, audio_sample_rate: f64) -> Self {
        Self::new(preset.config(), audio_sample_rate)
    }

    pub fn set_impulse_response(&mut self, channel: usize, response: &[f32], volume: f32) {
        self.synth.set_impulse_response(channel, response, volume);
    }

    pub fn set_impulse_response_all(&mut self, response: &[f32], volume: f32) {
        for channel in 0..self.synth.channel_count() {
            self.synth.set_impulse_response(channel, response, volume);
        }
    }

    pub fn audio_parameters(&self) -> AudioParameters {
        self.synth.audio_parameters()
    }

    pub fn set_audio_parameters(&mut self, params: AudioParameters) {
        self.synth.set_audio_parameters(params);
    }

    /// Advances the physics by one simulation step and feeds the synthesizer.
    pub fn step(&mut self) {
        self.engine.step(self.dt);
        self.write_to_synthesizer();
    }

    /// Port of `PistonEngineSimulator::writeToSynthesizer`.
    ///
    /// The signal is the exhaust runner's departure from atmospheric pressure
    /// plus a little of its dynamic pressure in both directions, delayed by the
    /// pipe's travel time, attenuated by distance and summed per exhaust
    /// system.
    fn write_to_synthesizer(&mut self) {
        for v in self.staging.iter_mut() {
            *v = 0.0;
        }

        let attenuation = self.engine.filtered_engine_speed.abs().min(40.0) / 40.0;
        let attenuation_3 = attenuation * attenuation * attenuation;

        let cylinder_count = self.engine.cylinder_count();
        let exhaust_count = self.staging.len();

        for i in 0..cylinder_count {
            let cylinder = &self.engine.cfg.cylinders[i];
            let exhaust_index = cylinder.exhaust.min(exhaust_count - 1);
            let exhaust = &self.engine.exhausts[exhaust_index];
            let exhaust_length = cylinder.header_primary_length + exhaust.length();

            let runner = &self.engine.chambers[i].exhaust_runner;
            let exhaust_flow = attenuation_3
                * 1600.0
                * (1.0 * (runner.pressure() - ATM)
                    + 0.1 * runner.dynamic_pressure(1.0, 0.0)
                    + 0.1 * runner.dynamic_pressure(-1.0, 0.0));

            let delayed = self.delay_filters[i].f(exhaust_flow);

            self.staging[exhaust_index] += cylinder.sound_attenuation
                * (exhaust.audio_volume() * delayed / cylinder_count as f64)
                * (1.0 / (exhaust_length * exhaust_length));
        }

        self.synth.write_input(&self.staging);
    }

    /// Fills `out` with audio, stepping the simulation as needed.
    pub fn render(&mut self, out: &mut [f32]) {
        let mut written = 0;
        // Bound the work per call so a pathological configuration cannot hang
        // the audio thread.
        let mut guard = out.len() * 8 + 1024;

        while written < out.len() {
            if self.synth.available() == 0 {
                self.step();
            }
            written += self.synth.render_into(&mut out[written..]);

            guard -= 1;
            if guard == 0 {
                for slot in out[written..].iter_mut() {
                    *slot = 0.0;
                }
                break;
            }
        }
    }

    // --- convenience controls -------------------------------------------

    pub fn set_throttle(&mut self, throttle: f64) {
        self.engine.set_speed_control(throttle);
    }

    pub fn set_starter(&mut self, enabled: bool) {
        self.engine.set_starter(enabled);
    }

    /// Whether the starter is still cranking.
    pub fn starter_engaged(&self) -> bool {
        self.engine.starter_engaged()
    }

    pub fn set_ignition(&mut self, enabled: bool) {
        self.engine.ignition.enabled = enabled;
    }

    pub fn set_load_torque(&mut self, torque: f64) {
        self.engine.load_torque = torque;
    }

    /// Selects a gear, or `None` for neutral.
    pub fn set_gear(&mut self, gear: Option<usize>) {
        self.engine.set_gear(gear);
    }

    pub fn gear(&self) -> Option<usize> {
        self.engine.gear()
    }

    pub fn gear_count(&self) -> usize {
        self.engine.cfg.vehicle.gear_count()
    }

    /// Road speed, m/s.
    pub fn road_speed(&self) -> f64 {
        self.engine.road_speed()
    }

    /// Forces the crank to a speed, moving the car to match if a gear is
    /// engaged. Sets rather than holds: call it every block to drive rpm.
    pub fn set_rpm(&mut self, rpm: f64) {
        self.engine.set_rpm(rpm);
    }

    pub fn rpm(&self) -> f64 {
        self.engine.rpm()
    }

    pub fn manifold_pressure(&self) -> f64 {
        self.engine.manifold_pressure()
    }

    /// Total swept volume, m³.
    pub fn displacement(&self) -> f64 {
        self.engine.cfg.displacement()
    }

    pub fn name(&self) -> &str {
        &self.engine.cfg.name
    }

    /// Rev limit, rad/s.
    pub fn rev_limit(&self) -> f64 {
        self.engine.cfg.rev_limit
    }

    pub fn bank_count(&self) -> usize {
        self.engine.cfg.banks.len()
    }

    /// Geometric compression ratio.
    pub fn compression_ratio(&self) -> f64 {
        let cylinders = self.engine.cylinder_count().max(1) as f64;
        let swept = self.engine.cfg.displacement() / cylinders;
        let chamber = self.engine.cfg.chamber_volume;
        if chamber > 0.0 {
            (swept + chamber) / chamber
        } else {
            0.0
        }
    }
}

/// A synthetic exhaust impulse response, so the library makes a plausible noise
/// before you load a real recording.
///
/// Real IRs (a starter pistol fired into a tailpipe, or the `.wav` files in the
/// original's `assets/sound-library`) sound considerably better; load one with
/// [`SoundEngine::set_impulse_response_all`].
pub fn default_impulse_response(sample_rate: f64, duration: f64) -> Vec<f32> {
    let len = (sample_rate * duration).max(16.0) as usize;
    let mut ir = vec![0.0f32; len];

    let mut rng = crate::filters::Rng::new(0xC0FF_EE01);

    // A few heavily damped pipe/body modes plus a short diffuse noise tail.
    //
    // `decay` is a time constant, so the ring-out is ~6.9x it: these are chosen
    // to put T60 near 35 ms, comfortably inside one firing interval (18.8 ms at
    // 800 rpm on a V8, 2.5 ms at 6000). A longer tail overlaps successive
    // cylinder events and smears them into a continuous resonant wash — the
    // response stops reading as an exhaust and starts reading as a small room.
    //
    // The low modes are damped hardest and kept modest on purpose. An open
    // tailpipe radiates low frequencies away rather than storing them, and a
    // strong slowly-decaying resonance down at 80 Hz colours every engine with
    // the same drone and buries the firing harmonics that carry the character.
    let modes: [(f64, f64, f64); 6] = [
        // (frequency Hz, decay time constant seconds, amplitude)
        (78.0, 0.0050, 0.14),
        (145.0, 0.0050, 0.24),
        (233.0, 0.0050, 0.36),
        (410.0, 0.0037, 0.38),
        (760.0, 0.0020, 0.28),
        (1320.0, 0.0011, 0.18),
    ];

    let mut low = 0.0f64;
    for (i, slot) in ir.iter_mut().enumerate() {
        let t = i as f64 / sample_rate;

        let mut v = 0.0;
        for &(freq, decay, amp) in modes.iter() {
            v += amp * (-t / decay).exp() * (2.0 * PI * freq * t).sin();
        }

        // Diffuse reflections, low-passed so the tail is not hissy.
        let noise = rng.bipolar() as f64;
        low += (noise - low) * 0.35;
        v += 0.35 * low * (-t / 0.004).exp();

        *slot = v as f32;
    }

    // Scale the resonant body to sit below the direct sound before adding it,
    // rather than writing the direct sample in and normalising afterwards. The
    // modes ring up to a peak of their own a few samples in, so writing
    // `ir[0] = 1.0` and dividing by the overall peak left the leading edge at
    // 0.8 and the body louder than the direct path — an inside-a-box signature.
    // Doing it this way pins the peak at sample 0 and keeps the direct-to-
    // reverberant ratio positive (~+9 dB), which is what makes an exhaust pulse
    // keep its edge.
    const BODY_LEVEL: f32 = 0.631; // -4 dB relative to the direct impulse
    let body_peak = ir.iter().fold(0.0f32, |a, b| a.max(b.abs()));
    if body_peak > 0.0 {
        let g = BODY_LEVEL / body_peak;
        for s in ir.iter_mut() {
            *s *= g;
        }
    }

    // Sharp leading edge: the direct sound.
    ir[0] += 1.0;

    let peak = ir.iter().fold(0.0f32, |a, b| a.max(b.abs()));
    if peak > 0.0 {
        for s in ir.iter_mut() {
            *s /= peak;
        }
    }

    ir
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Preset;

    fn run(preset: Preset, seconds: f64, throttle: f64) -> (SoundEngine, Vec<f32>) {
        let sample_rate = 44100.0;
        let mut e = SoundEngine::from_preset(preset, sample_rate);
        e.set_starter(true);
        e.set_throttle(throttle);

        let total = (sample_rate * seconds) as usize;
        let mut out = vec![0.0f32; total];
        let mut cursor = 0;
        let mut started = false;
        while cursor < total {
            let end = (cursor + 512).min(total);
            e.render(&mut out[cursor..end]);
            cursor = end;
            if !started && e.rpm() > 400.0 {
                e.set_starter(false);
                started = true;
            }
        }
        (e, out)
    }

    #[test]
    fn the_starter_releases_itself_once_the_engine_catches() {
        let mut e = SoundEngine::from_preset(Preset::Inline4, 44100.0);
        e.set_starter(true);
        e.set_throttle(0.0);
        assert!(e.starter_engaged());

        let mut out = vec![0.0f32; 512];
        let mut t = 0.0;
        while t < 10.0 && e.starter_engaged() {
            e.render(&mut out);
            t += 512.0 / 44100.0;
        }

        assert!(!e.starter_engaged(), "starter never released");
        assert!(e.rpm() > 500.0, "released without the engine catching");
        assert!(t < 8.0, "released on the timeout rather than on catching");
    }

    #[test]
    fn the_starter_gives_up_if_the_engine_cannot_catch() {
        // Held down by more load than it can overcome, the engine spins at
        // starter speed and never fires. The starter has to let go anyway —
        // otherwise it cranks forever and no caller can tell that the control
        // did anything at all.
        let mut e = SoundEngine::from_preset(Preset::Inline4, 44100.0);
        e.set_load_torque(400.0);
        e.set_throttle(0.0);
        e.set_starter(true);

        let mut out = vec![0.0f32; 512];
        let mut t = 0.0;
        while t < 20.0 && e.starter_engaged() {
            e.render(&mut out);
            t += 512.0 / 44100.0;
        }

        assert!(!e.starter_engaged(), "starter cranked forever");
        assert!(
            e.rpm() < 500.0,
            "engine caught after all; pick a bigger load"
        );

        // And a second press buys another attempt rather than doing nothing.
        e.set_starter(true);
        assert!(e.starter_engaged());
        for _ in 0..20 {
            e.render(&mut out);
        }
        assert!(e.starter_engaged(), "second attempt released immediately");
    }

    #[test]
    fn forcing_rpm_keeps_the_drivetrain_consistent() {
        let mut e = SoundEngine::from_preset(Preset::V8Crossplane, 44100.0);
        let mut out = vec![0.0f32; 512];

        // In neutral the car is not involved at all.
        e.set_gear(None);
        e.set_rpm(4000.0);
        assert!((e.rpm() - 4000.0).abs() < 1.0);
        assert_eq!(e.road_speed(), 0.0);

        // In gear it is moved to match, rather than left behind for the clutch
        // to drag up — which would sound like dropping the clutch.
        let gear = 2;
        e.set_gear(Some(gear));
        e.set_rpm(4000.0);
        let expected = e
            .engine
            .cfg
            .vehicle
            .speed_for(-crate::units::rpm(4000.0), Some(gear))
            .unwrap();
        assert!(
            (e.road_speed() - expected).abs() < 1e-9,
            "{} vs {expected} m/s",
            e.road_speed()
        );
        assert!(e.road_speed() > 0.0);

        // And it stays consistent: with the clutch already matched there is
        // nothing for it to slam shut, so the speed holds.
        let before = e.road_speed();
        e.set_throttle(0.5);
        for _ in 0..40 {
            e.render(&mut out);
        }
        assert!(
            (e.road_speed() - before).abs() / before < 0.2,
            "the car lurched: {before} -> {}",
            e.road_speed()
        );
    }

    #[test]
    fn forcing_rpm_sets_rather_than_holds() {
        // It is a set, not a governor: combustion takes over from the next
        // step. A caller driving rpm has to keep asking.
        let mut e = SoundEngine::from_preset(Preset::Inline4, 44100.0);
        let mut out = vec![0.0f32; 512];
        e.set_throttle(1.0);
        e.set_rpm(3000.0);

        for _ in 0..80 {
            e.render(&mut out);
        }
        let drifted = e.rpm();
        assert!(
            (drifted - 3000.0).abs() > 50.0,
            "expected it to drift away from 3000, got {drifted}"
        );

        // Re-asserting each block keeps it there.
        for _ in 0..80 {
            e.set_rpm(3000.0);
            e.render(&mut out);
        }
        assert!(
            (e.rpm() - 3000.0).abs() < 400.0,
            "re-asserting did not hold it: {} rpm",
            e.rpm()
        );
    }

    #[test]
    fn engine_starts_and_idles() {
        let (e, _) = run(Preset::Inline4, 3.0, 0.06);
        let rpm = e.rpm();
        assert!(
            (300.0..4000.0).contains(&rpm),
            "engine did not settle to a plausible idle: {rpm} rpm"
        );
    }

    #[test]
    fn throttle_raises_engine_speed() {
        let (idle, _) = run(Preset::V8Crossplane, 3.0, 0.05);
        let (wot, _) = run(Preset::V8Crossplane, 3.0, 1.0);
        assert!(
            wot.rpm() > idle.rpm() * 1.5,
            "throttle had no effect: idle {} vs wot {}",
            idle.rpm(),
            wot.rpm()
        );
    }

    #[test]
    fn output_is_finite_and_bounded() {
        let (_, out) = run(Preset::V8Flatplane, 2.0, 0.5);
        assert!(out.iter().all(|s| s.is_finite()));
        assert!(out.iter().all(|s| s.abs() <= 1.0));
    }

    #[test]
    fn running_engine_makes_sound() {
        let (_, out) = run(Preset::V8Crossplane, 3.0, 0.4);
        // Ignore the first second: cranking and the leveler settling.
        let tail = &out[44100..];
        let rms = (tail.iter().map(|s| (s * s) as f64).sum::<f64>() / tail.len() as f64).sqrt();
        assert!(rms > 0.01, "output is essentially silent, rms {rms}");
    }

    #[test]
    fn every_preset_runs_without_blowing_up() {
        for &preset in Preset::all() {
            let (e, out) = run(preset, 1.5, 0.5);
            assert!(
                out.iter().all(|s| s.is_finite()),
                "{} produced non-finite audio",
                preset.name()
            );
            assert!(
                e.rpm().is_finite() && e.rpm() < 30000.0,
                "{} ran away to {} rpm",
                preset.name(),
                e.rpm()
            );
        }
    }

    /// Renders at a held crank speed and returns the audio tail.
    fn render_at_fixed_rpm(preset: Preset, rpm: f64, sample_rate: f64) -> Vec<f32> {
        let mut e = SoundEngine::from_preset(preset, sample_rate);
        e.set_throttle(0.8);
        e.set_rpm(rpm);

        let mut out = vec![0.0f32; sample_rate as usize];
        let mut cursor = 0;
        while cursor < out.len() {
            let end = (cursor + 256).min(out.len());
            // Re-assert every block so combustion cannot change the speed.
            e.set_rpm(rpm);
            e.render(&mut out[cursor..end]);
            cursor = end;
        }

        out.split_off(out.len() / 2)
    }

    /// Firing frequency: one power stroke per cylinder every two revolutions.
    fn firing_frequency(rpm: f64, cylinders: f64) -> f64 {
        (rpm / 60.0) * (cylinders / 2.0)
    }

    #[test]
    fn output_is_periodic_at_the_firing_frequency() {
        // Which harmonic is loudest depends on the impulse response, so rather
        // than demand the fundamental dominate, check that energy concentrates
        // on multiples of the firing frequency and not between them.
        let sample_rate = 44100.0;

        for (preset, cylinders, rpm) in [
            (Preset::Inline4, 4.0, 3000.0),
            (Preset::Inline6, 6.0, 2400.0),
            (Preset::V8Crossplane, 8.0, 2100.0),
        ] {
            let signal = render_at_fixed_rpm(preset, rpm, sample_rate);
            let f0 = firing_frequency(rpm, cylinders);

            let harmonic: f64 = (1..=4)
                .map(|h| goertzel_power(&signal, sample_rate, f0 * h as f64))
                .sum();
            // Halfway between harmonics: nothing should live here.
            let between: f64 = (1..=4)
                .map(|h| goertzel_power(&signal, sample_rate, f0 * (h as f64 - 0.5)))
                .sum();

            // Not a pure tone: jitter, air noise and the impulse response all
            // spread energy around, so this checks for clear concentration
            // rather than a clean line spectrum.
            assert!(
                harmonic > between * 2.5,
                "{}: harmonic power {harmonic:.3e} vs off-harmonic {between:.3e}",
                preset.name()
            );
        }
    }

    #[test]
    fn pitch_tracks_engine_speed() {
        let sample_rate = 44100.0;
        let low = render_at_fixed_rpm(Preset::Inline4, 1800.0, sample_rate);
        let high = render_at_fixed_rpm(Preset::Inline4, 3600.0, sample_rate);

        let f_low = firing_frequency(1800.0, 4.0);
        let f_high = firing_frequency(3600.0, 4.0);

        // Each signal should be strong at its own firing frequency and weak at
        // the other one.
        assert!(
            goertzel_power(&low, sample_rate, f_low) > goertzel_power(&low, sample_rate, f_high),
            "1800 rpm signal is not strongest at its own firing frequency"
        );
        assert!(
            goertzel_power(&high, sample_rate, f_high) > goertzel_power(&high, sample_rate, f_low),
            "3600 rpm signal is not strongest at its own firing frequency"
        );
    }

    #[test]
    fn cylinder_count_changes_the_firing_frequency() {
        // Same crank speed, more cylinders: the firing rate goes up with them.
        let sample_rate = 44100.0;
        let rpm = 2400.0;

        let four = render_at_fixed_rpm(Preset::Inline4, rpm, sample_rate);
        let six = render_at_fixed_rpm(Preset::Inline6, rpm, sample_rate);

        let f4 = firing_frequency(rpm, 4.0); // 80 Hz
        let f6 = firing_frequency(rpm, 6.0); // 120 Hz

        assert!(
            goertzel_power(&four, sample_rate, f4) > goertzel_power(&four, sample_rate, f6),
            "the inline 4 is not firing at {f4} Hz"
        );
        assert!(
            goertzel_power(&six, sample_rate, f6) > goertzel_power(&six, sample_rate, f4),
            "the inline 6 is not firing at {f6} Hz"
        );
    }

    /// Power at a single frequency, via the Goertzel algorithm.
    fn goertzel_power(signal: &[f32], sample_rate: f64, frequency: f64) -> f64 {
        let w = 2.0 * PI * frequency / sample_rate;
        let coeff = 2.0 * w.cos();
        let (mut s1, mut s2) = (0.0f64, 0.0f64);
        for &x in signal {
            let s0 = x as f64 + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        s1 * s1 + s2 * s2 - coeff * s1 * s2
    }
}
