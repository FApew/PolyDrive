//! Renders the built-in Fiat 500 L preset: cranking, idle, two throttle blips
//! and a cruise.
//!
//! Engine 110F.000: 499.5 cc air-cooled OHV parallel twin, 67.4 x 70 mm, 7.1:1,
//! 18 hp at 4600 rpm, one Weber 26 IMB.
//!
//! The crank is a **360°** one: both pistons rise together and fire one full
//! revolution apart, which is what gives the even beat. The engine is defined
//! in `src/config.rs`; `js/examples/fiat500.js` builds the same thing from
//! scratch if you want to see how a custom engine goes together.
//!
//! ```text
//! cargo run --release --example fiat500 -- fiat500.wav
//! ```

use engine_sound::config::Preset;
use engine_sound::sim::SoundEngine;
use engine_sound::units::*;

fn main() {
    let out_path = std::env::args().nth(1).unwrap_or("fiat500.wav".to_string());

    let cfg = Preset::Fiat500.config();
    println!("{}", cfg.name);
    println!(
        "  displacement  {:.1} cc  ({:.1} x {:.1} mm)",
        cfg.displacement() / CC,
        cfg.bore / MM,
        cfg.crank_throw * 2.0 / MM
    );
    let swept = cfg.displacement() / 2.0;
    println!(
        "  compression   {:.2}:1  (chamber {:.1} cc)",
        (swept + cfg.chamber_volume) / cfg.chamber_volume,
        cfg.chamber_volume / CC
    );
    let mut angles: Vec<f64> = cfg
        .cylinders
        .iter()
        .map(|c| c.ignition_angle / DEG)
        .collect();
    angles.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("  fires at      {angles:?} degrees");

    let sample_rate = 44100.0;
    let mut engine = SoundEngine::new(cfg, sample_rate);
    engine.set_starter(true);
    engine.set_throttle(0.0);

    let seconds = 14.0;
    let total = (sample_rate * seconds) as usize;
    let mut out = vec![0.0f32; total];
    let mut cursor = 0;
    let mut next_report = 0.0;

    while cursor < total {
        let end = (cursor + 256).min(total);
        let t = cursor as f64 / sample_rate;

        // Idle, blip, idle, then hold a cruise.
        let throttle = match t {
            t if t < 4.0 => 0.0,
            t if t < 5.5 => 1.0,
            t if t < 8.0 => 0.0,
            t if t < 9.5 => 1.0,
            t if t < 11.0 => 0.0,
            _ => 0.45,
        };
        engine.set_throttle(throttle);
        engine.set_load_torque(4.0 + 10.0 * throttle);

        engine.render(&mut out[cursor..end]);
        cursor = end;

        if t >= next_report {
            println!(
                "  t={t:5.1}s  throttle={throttle:.2}  rpm={:5.0}  map={:5.1} kPa",
                engine.rpm(),
                engine.manifold_pressure() / 1000.0
            );
            next_report += 1.0;
        }
    }

    write_wav(&out_path, &out, sample_rate as u32).expect("failed to write wav");
    println!("wrote {out_path}");
}

fn write_wav(path: &str, samples: &[f32], sample_rate: u32) -> std::io::Result<()> {
    use std::io::Write;
    let mut w = std::io::BufWriter::new(std::fs::File::create(path)?);
    let data_len = samples.len() as u32 * 2;

    w.write_all(b"RIFF")?;
    w.write_all(&(36 + data_len).to_le_bytes())?;
    w.write_all(b"WAVEfmt ")?;
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
        w.write_all(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes())?;
    }
    w.flush()
}
