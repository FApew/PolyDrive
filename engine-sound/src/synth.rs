//! The synthesizer.
//!
//! Port of `include/synthesizer.h` / `src/synthesizer.cpp`.
//!
//! The per-sample DSP is identical to the original. What changed is the
//! plumbing: the C++ version runs a dedicated rendering thread that feeds a
//! ring buffer, with a latency controller in `Simulator::startFrame` throttling
//! the physics to keep the buffer roughly full. In a browser there is exactly
//! one audio thread and it *pulls*, so this version is a synchronous
//! pull-model: `render_into` consumes as many upsampled input samples as it
//! needs, and the caller steps the simulation whenever the queue runs dry. Same
//! signal, no threads, no latency drift.

use crate::filters::{
    ButterworthLowPassFilter, ConvolutionFilter, DerivativeFilter, JitterFilter, LevelingFilter,
    LowPassFilter, Rng,
};
use std::collections::VecDeque;

#[derive(Clone, Copy, Debug)]
pub struct AudioParameters {
    pub volume: f32,
    /// Wet/dry mix for the impulse response convolution.
    pub convolution: f32,
    /// How much of the differentiated signal to mix in (high frequency gain).
    pub df_f_mix: f32,
    /// Jitter filter depth (high frequency noise).
    pub input_sample_noise: f32,
    pub input_sample_noise_frequency_cutoff: f32,
    /// Amplitude modulation by filtered white noise (air rush).
    pub air_noise: f32,
    pub air_noise_frequency_cutoff: f32,
    pub leveler_target: f32,
    pub leveler_max_gain: f32,
    pub leveler_min_gain: f32,
}

impl Default for AudioParameters {
    fn default() -> Self {
        Self {
            volume: 1.0,
            convolution: 1.0,
            df_f_mix: 0.01,
            input_sample_noise: 0.5,
            input_sample_noise_frequency_cutoff: 10000.0,
            air_noise: 1.0,
            air_noise_frequency_cutoff: 2000.0,
            leveler_target: 30000.0,
            leveler_max_gain: 1.9,
            leveler_min_gain: 0.00001,
        }
    }
}

#[derive(Clone, Debug)]
pub struct SynthesizerParameters {
    pub input_channel_count: usize,
    pub input_sample_rate: f64,
    pub audio_sample_rate: f64,
    /// Hard cap on impulse response length. The original clamps at 10000 taps
    /// because it convolves directly; partitioned FFT convolution makes long
    /// responses cheap, so this is generous — 16384 taps is a 0.37 s tail at
    /// 44.1 kHz, longer than any of the original's sound library.
    pub max_impulse_response_samples: usize,
    pub initial_audio_parameters: AudioParameters,
}

impl Default for SynthesizerParameters {
    fn default() -> Self {
        Self {
            input_channel_count: 1,
            input_sample_rate: 10000.0,
            audio_sample_rate: 44100.0,
            max_impulse_response_samples: 16384,
            initial_audio_parameters: AudioParameters::default(),
        }
    }
}

#[derive(Clone, Debug, Default)]
struct InputChannel {
    /// Upsampled, band-limited samples waiting to be rendered.
    pending: VecDeque<f32>,
    last_input_sample: f64,
    /// Position of the next output sample inside the current input interval,
    /// in units of one input interval.
    t: f64,

    convolution: ConvolutionFilter,
    derivative: DerivativeFilter,
    jitter: JitterFilter,
    input_dc_filter: LowPassFilter,
    /// Anti-imaging filter applied while upsampling to the audio rate.
    upsample_antialiasing: ButterworthLowPassFilter,
}

pub struct Synthesizer {
    channels: Vec<InputChannel>,
    /// Note: the original indexes this filter as `m_filters->airNoiseLowPass`,
    /// i.e. channel 0's filter is used for every channel. Modelled here as a
    /// single shared filter, which is the same thing.
    air_noise_low_pass: ButterworthLowPassFilter,
    output_antialiasing: ButterworthLowPassFilter,
    leveling: LevelingFilter,

    params: AudioParameters,
    input_sample_rate: f64,
    audio_sample_rate: f64,
    max_impulse_response_samples: usize,

    rng: Rng,
}

impl Synthesizer {
    pub fn new(p: &SynthesizerParameters) -> Self {
        let mut channels = Vec::with_capacity(p.input_channel_count);
        for _ in 0..p.input_channel_count {
            let mut c = InputChannel::default();
            c.derivative.dt = 1.0 / p.audio_sample_rate as f32;
            c.input_dc_filter.set_cutoff_frequency(10.0);
            c.input_dc_filter.dt = 1.0 / p.audio_sample_rate as f32;
            c.jitter.initialize(
                10,
                p.initial_audio_parameters
                    .input_sample_noise_frequency_cutoff as f64,
                p.audio_sample_rate,
            );
            c.upsample_antialiasing
                .set_cutoff_frequency(1900.0, p.audio_sample_rate);
            channels.push(c);
        }

        let mut air_noise_low_pass = ButterworthLowPassFilter::default();
        air_noise_low_pass.set_cutoff_frequency(
            p.initial_audio_parameters.air_noise_frequency_cutoff as f64,
            p.audio_sample_rate,
        );

        let mut output_antialiasing = ButterworthLowPassFilter::default();
        output_antialiasing.set_cutoff_frequency(p.audio_sample_rate * 0.45, p.audio_sample_rate);

        let leveling = LevelingFilter::new(
            p.initial_audio_parameters.leveler_target,
            p.initial_audio_parameters.leveler_min_gain,
            p.initial_audio_parameters.leveler_max_gain,
        );

        Self {
            channels,
            air_noise_low_pass,
            output_antialiasing,
            leveling,
            params: p.initial_audio_parameters,
            input_sample_rate: p.input_sample_rate,
            audio_sample_rate: p.audio_sample_rate,
            max_impulse_response_samples: p.max_impulse_response_samples,
            rng: Rng::new(0x9E37_79B9),
        }
    }

    pub fn channel_count(&self) -> usize {
        self.channels.len()
    }

    pub fn audio_parameters(&self) -> AudioParameters {
        self.params
    }

    pub fn set_audio_parameters(&mut self, params: AudioParameters) {
        if params.air_noise_frequency_cutoff != self.params.air_noise_frequency_cutoff {
            self.air_noise_low_pass.set_cutoff_frequency(
                params.air_noise_frequency_cutoff as f64,
                self.audio_sample_rate,
            );
        }
        self.params = params;
        self.leveling.target = params.leveler_target;
        self.leveling.max_level = params.leveler_max_gain;
        self.leveling.min_level = params.leveler_min_gain;
    }

    pub fn set_input_sample_rate(&mut self, rate: f64) {
        self.input_sample_rate = rate;
    }

    pub fn leveler_gain(&self) -> f32 {
        self.leveling.attenuation()
    }

    /// Installs an impulse response for one input channel.
    ///
    /// Mirrors `Synthesizer::initializeImpulseResponse`: the tail is trimmed at
    /// the last sample whose magnitude exceeds 100/32767, then clamped to the
    /// configured maximum length.
    pub fn set_impulse_response(&mut self, channel: usize, response: &[f32], volume: f32) {
        if channel >= self.channels.len() {
            return;
        }

        const THRESHOLD: f32 = 100.0 / 32767.0;
        let mut clipped_length = 0usize;
        for (i, &s) in response.iter().enumerate() {
            if s.abs() > THRESHOLD {
                clipped_length = i + 1;
            }
        }

        let sample_count = clipped_length.min(self.max_impulse_response_samples);
        let filter = &mut self.channels[channel].convolution;
        filter.initialize(sample_count);
        let ir = filter.impulse_response_mut();
        for i in 0..sample_count {
            ir[i] = volume * response[i];
        }
        filter.commit();
    }

    /// Number of audio-rate samples currently queued and ready to render.
    pub fn available(&self) -> usize {
        self.channels.first().map(|c| c.pending.len()).unwrap_or(0)
    }

    /// Accepts one simulation-rate sample per input channel, resampling to the
    /// audio rate. Port of `Synthesizer::writeInput`.
    pub fn write_input(&mut self, data: &[f64]) {
        // Output samples per input sample.
        let ratio = self.audio_sample_rate / self.input_sample_rate;
        if ratio <= 0.0 || !ratio.is_finite() {
            return;
        }
        let step = 1.0 / ratio;

        for (i, channel) in self.channels.iter_mut().enumerate() {
            let v = data.get(i).copied().unwrap_or(0.0);
            let p = channel.last_input_sample;

            while channel.t < 1.0 {
                let f = channel.t;
                let sample = p * (1.0 - f) + v * f;
                let filtered = channel.upsample_antialiasing.f(sample);
                channel.pending.push_back(filtered as f32);
                channel.t += step;
            }
            channel.t -= 1.0;

            channel.last_input_sample = v;
        }
    }

    /// Renders up to `out.len()` samples, returning how many were produced.
    /// Stops early when the input queue is exhausted.
    pub fn render_into(&mut self, out: &mut [f32]) -> usize {
        let n = self.available().min(out.len());
        for slot in out.iter_mut().take(n) {
            *slot = self.render_sample();
        }
        n
    }

    /// Port of `Synthesizer::renderAudio(int inputOffset)`.
    fn render_sample(&mut self) -> f32 {
        let air_noise = self.params.air_noise;
        let df_f_mix = self.params.df_f_mix;
        let conv_amount = self.params.convolution;
        let jitter_scale = self.params.input_sample_noise;

        let mut signal = 0.0f32;
        for channel in self.channels.iter_mut() {
            let input = channel.pending.pop_front().unwrap_or(0.0);

            channel.jitter.set_jitter_scale(jitter_scale);
            let jittered = channel.jitter.f(input);

            let f_in = jittered;
            let f_dc = channel.input_dc_filter.f(f_in);
            let f = f_in - f_dc;
            let f_p = channel.derivative.f(f_in);

            let noise = self.rng.bipolar();
            let r = self.air_noise_low_pass.f32(noise);
            let r_mixed = air_noise * r + (1.0 - air_noise);

            let mut v_in = f_p * df_f_mix + f * r_mixed * (1.0 - df_f_mix);
            if !v_in.is_normal() && v_in != 0.0 {
                v_in = 0.0;
            }

            let v = conv_amount * channel.convolution.f(v_in) + (1.0 - conv_amount) * v_in;
            signal += v;
        }

        signal = self.output_antialiasing.f32(signal);

        let leveled = self.leveling.f(signal) * self.params.volume;

        // The original renders 16-bit PCM; keep the same clipping behaviour and
        // normalise on the way out so the caller gets float audio.
        let clipped = leveled.round().clamp(-32768.0, 32767.0);
        clipped / 32768.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsampling_produces_expected_rate() {
        let mut s = Synthesizer::new(&SynthesizerParameters {
            input_channel_count: 1,
            input_sample_rate: 10000.0,
            audio_sample_rate: 44100.0,
            ..Default::default()
        });

        for _ in 0..1000 {
            s.write_input(&[1.0]);
        }

        let produced = s.available() as f64;
        let expected = 1000.0 * 44100.0 / 10000.0;
        assert!(
            (produced - expected).abs() < 4.0,
            "produced {produced}, expected {expected}"
        );
    }

    #[test]
    fn silence_in_silence_out() {
        let mut s = Synthesizer::new(&SynthesizerParameters::default());
        for _ in 0..5000 {
            s.write_input(&[0.0]);
        }
        let mut out = vec![0.0f32; 4096];
        let n = s.render_into(&mut out);
        assert!(n > 0);
        assert!(out[..n].iter().all(|v| v.abs() < 1e-6));
    }

    #[test]
    fn output_stays_in_range() {
        let mut s = Synthesizer::new(&SynthesizerParameters::default());
        let mut out = vec![0.0f32; 512];
        for i in 0..20000 {
            s.write_input(&[if i % 97 == 0 { 5000.0 } else { 0.0 }]);
            if s.available() >= out.len() {
                let n = s.render_into(&mut out);
                assert!(out[..n].iter().all(|v| v.abs() <= 1.0));
            }
        }
    }
}
