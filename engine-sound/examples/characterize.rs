use engine_sound::sim::SoundEngine;

fn main() {
    println!(
        "{:>22} {:>8} {:>8} {:>8} {:>10}",
        "engine", "start_s", "idle", "wot", "coast_s"
    );
    for &p in engine_sound::config::Preset::all() {
        let sr = 44100.0;
        let mut e = SoundEngine::from_preset(p, sr);
        e.set_starter(true);
        e.set_throttle(0.0);
        let mut out = vec![0.0f32; 512];
        let mut t = 0.0;
        let mut start_t = f64::NAN;
        // start + idle for 10 s
        while t < 10.0 {
            e.render(&mut out);
            t += 512.0 / sr;
            if start_t.is_nan() && e.rpm() > 500.0 {
                start_t = t;
            }
        }
        let idle = e.rpm();
        // WOT for 6 s
        e.set_throttle(1.0);
        while t < 16.0 {
            e.render(&mut out);
            t += 512.0 / sr;
        }
        let wot = e.rpm();
        // coast back down
        e.set_throttle(0.0);
        let coast_start = t;
        while t < 30.0 && e.rpm() > idle * 1.25 {
            e.render(&mut out);
            t += 512.0 / sr;
        }
        println!(
            "{:>22} {:>8.1} {:>8.0} {:>8.0} {:>10.1}",
            p.name(),
            start_t,
            idle,
            wot,
            t - coast_start
        );
    }
}
