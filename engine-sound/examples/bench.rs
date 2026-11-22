use engine_sound::{config::Preset, sim::SoundEngine};
use std::time::Instant;

fn bench(label: &str, ir_len: usize) {
    let sr = 44100.0;
    let mut e = SoundEngine::from_preset(Preset::V8Crossplane, sr);
    let ir = engine_sound::sim::default_impulse_response(sr, ir_len as f64 / sr);
    e.set_impulse_response_all(&ir, 1.0);
    e.set_starter(true);
    e.set_throttle(0.5);
    let mut out = vec![0.0f32; 256];
    // warm up
    for _ in 0..200 {
        e.render(&mut out);
    }
    let n = 44100 * 5 / 256;
    let t = Instant::now();
    for _ in 0..n {
        e.render(&mut out);
    }
    let el = t.elapsed().as_secs_f64();
    println!("{label:>28}: {:.2}x realtime", (n * 256) as f64 / sr / el);
}

fn main() {
    bench("conv off (ir=1)", 1);
    bench("ir = 512", 512);
    bench("ir = 2048", 2048);
    bench("ir = 4096", 4096);
}
