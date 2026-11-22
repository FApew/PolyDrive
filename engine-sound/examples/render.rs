//! Renders a throttle sweep to a WAV file and reports realtime headroom.
//!
//! ```text
//! cargo run --release --example render -- v8_crossplane out.wav
//! ```

use engine_sound::{config::Preset, sim::SoundEngine};
use std::env;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::time::Instant;

fn main() {
    let args: Vec<String> = env::args().collect();
    let preset_name = args.get(1).map(String::as_str).unwrap_or("v8_crossplane");
    let out_path = args.get(2).map(String::as_str).unwrap_or("engine.wav");

    let preset = Preset::from_slug(preset_name).unwrap_or_else(|| {
        let names: Vec<&str> = Preset::all().iter().map(|p| p.slug()).collect();
        eprintln!(
            "unknown preset '{preset_name}'. Try one of: {}",
            names.join(", ")
        );
        std::process::exit(1);
    });

    let sample_rate = 44100.0;
    let seconds = 12.0;
    let total = (sample_rate * seconds) as usize;

    let mut engine = SoundEngine::from_preset(preset, sample_rate);
    engine.set_starter(true);
    engine.set_throttle(0.0);
    engine.set_load_torque(15.0);

    let mut out = vec![0.0f32; total];
    let block = 256;
    let start = Instant::now();

    let mut cursor = 0;
    let mut started = false;
    let mut next_report = 0.0;

    while cursor < total {
        let end = (cursor + block).min(total);
        let t = cursor as f64 / sample_rate;

        if !started && engine.rpm() > 500.0 {
            engine.set_starter(false);
            started = true;
        }

        // Idle, then two throttle blips, then hold.
        let throttle = match t {
            t if t < 3.0 => 0.0,
            t if t < 4.2 => 1.0,
            t if t < 5.5 => 0.0,
            t if t < 7.0 => 1.0,
            t if t < 8.5 => 0.0,
            _ => 0.55,
        };
        engine.set_throttle(throttle);
        engine.set_load_torque(15.0 + 45.0 * throttle);

        engine.render(&mut out[cursor..end]);
        cursor = end;

        if t >= next_report {
            println!(
                "t={:5.2}s  throttle={:.2}  rpm={:7.0}  map={:5.1} kPa",
                t,
                throttle,
                engine.rpm(),
                engine.manifold_pressure() / 1000.0
            );
            next_report += 0.5;
        }
    }

    let elapsed = start.elapsed().as_secs_f64();
    println!(
        "\n{}: rendered {seconds:.0}s of audio in {elapsed:.2}s ({:.1}x realtime)",
        preset.name(),
        seconds / elapsed
    );

    let peak = out.iter().fold(0.0f32, |a, b| a.max(b.abs()));
    let rms = (out.iter().map(|s| (s * s) as f64).sum::<f64>() / out.len() as f64).sqrt();
    println!("peak {peak:.3}  rms {rms:.4}");

    write_wav(out_path, &out, sample_rate as u32).expect("failed to write wav");
    println!("wrote {out_path}");
}

fn write_wav(path: &str, samples: &[f32], sample_rate: u32) -> std::io::Result<()> {
    let mut w = BufWriter::new(File::create(path)?);
    let data_len = samples.len() as u32 * 2;

    w.write_all(b"RIFF")?;
    w.write_all(&(36 + data_len).to_le_bytes())?;
    w.write_all(b"WAVE")?;
    w.write_all(b"fmt ")?;
    w.write_all(&16u32.to_le_bytes())?;
    w.write_all(&1u16.to_le_bytes())?;
    w.write_all(&1u16.to_le_bytes())?;
    w.write_all(&sample_rate.to_le_bytes())?;
    w.write_all(&(sample_rate * 2).to_le_bytes())?;
    w.write_all(&2u16.to_le_bytes())?;
    w.write_all(&16u16.to_le_bytes())?;
    w.write_all(b"data")?;
    w.write_all(&data_len.to_le_bytes())?;

    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        w.write_all(&v.to_le_bytes())?;
    }

    w.flush()
}
