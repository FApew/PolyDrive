//! Physically-based engine sound synthesis.
//!
//! A Rust port of the audio algorithm from
//! [engine-sim](https://github.com/ange-yaghi/engine-sim) by Ange Yaghi,
//! stripped down to the parts that make noise and packaged so it can be driven
//! from a browser `AudioWorklet` (and therefore from React).
//!
//! # How the sound is made
//!
//! Nothing here is a sample or an oscillator. The chain is:
//!
//! 1. A slider-crank turns crank angle into piston position, which sets each
//!    cylinder's volume ([`engine::piston_kinematics`]).
//! 2. Cam lobes open and close the valves, setting port flow coefficients.
//! 3. A lumped compressible [`gas::GasSystem`] per plenum, runner, cylinder and
//!    collector exchanges mass, energy and momentum every sub-step. Combustion
//!    adds energy through a travelling flame front.
//! 4. The exhaust runner's pressure deviation is delayed by the pipe's acoustic
//!    travel time, scaled per cylinder and summed per exhaust system. That is
//!    the raw excitation signal.
//! 5. [`synth::Synthesizer`] upsamples it to the audio rate, adds jitter and
//!    air noise, mixes in its derivative for high-frequency bite, convolves it
//!    with a recorded exhaust impulse response and auto-levels the result.
//!
//! # Example
//!
//! ```
//! use engine_sound::{config::Preset, sim::SoundEngine};
//!
//! let mut engine = SoundEngine::from_preset(Preset::V8Crossplane, 44100.0);
//! engine.set_starter(true);
//! engine.set_throttle(0.2);
//!
//! let mut buffer = vec![0.0f32; 1024];
//! engine.render(&mut buffer);
//! assert!(buffer.iter().all(|s| s.is_finite()));
//! ```
//!
//! # Differences from the original
//!
//! * The rigid-body constraint solver is replaced by exact slider-crank
//!   kinematics plus a single-inertia crankshaft. Everything that determines
//!   the sound — cylinder pressure, valve timing, gas dynamics, the whole DSP
//!   chain — is a direct port. See [`engine`] for the reasoning.
//! * The synthesizer is pull-driven instead of running its own thread, because
//!   an `AudioWorklet` is single-threaded and pulls. Same per-sample maths.
//! * Impulse responses default to a shorter tap limit than the original's
//!   10 000, since direct-form convolution has to fit in an audio callback.
//! * The vehicle, transmission, dynamometer, scripting language and rendering
//!   are all gone.

pub mod config;
pub mod drivetrain;
pub mod engine;
pub mod ffi;
pub mod filters;
pub mod function;
pub mod gas;
pub mod mr;
pub mod sim;
pub mod synth;
pub mod units;
pub mod wav;

pub use config::{EngineConfig, Preset};
pub use sim::SoundEngine;
pub use synth::AudioParameters;
