// Accelerates through the gearbox, shifting near the limiter.
use engine_sound::{config::Preset, sim::SoundEngine, units::to_rpm};

fn main() {
    let sr = 44100.0;
    let mut e = SoundEngine::from_preset(Preset::V8Crossplane, sr);
    let gears = e.gear_count();
    let shift_at = to_rpm(e.engine.cfg.rev_limit) * 0.94;

    e.set_starter(true);
    e.set_throttle(0.0);
    let mut out = vec![0.0f32; 512];
    let mut t = 0.0;
    while t < 6.0 {
        e.render(&mut out);
        t += 512.0 / sr;
    }
    println!(
        "idle {:.0} rpm, {gears} gears, shifting at {shift_at:.0}",
        e.rpm()
    );

    e.set_gear(Some(0));
    e.set_throttle(1.0);
    let mut gear = 0;
    let mut next = 0.0;
    // The clutch takes a moment to drag the engine down to the new ratio, so
    // give it one before considering another shift.
    let mut shift_cooldown = 0.0;
    while t < 40.0 {
        e.render(&mut out);
        t += 512.0 / sr;

        shift_cooldown -= 512.0 / sr;
        if e.rpm() > shift_at && gear + 1 < gears && shift_cooldown <= 0.0 {
            shift_cooldown = 0.6;
            let before = e.rpm();
            gear += 1;
            e.set_gear(Some(gear));
            println!(
                "  shift {}->{} at {:.1}s — {:.0} rpm, {:.0} km/h",
                gear,
                gear + 1,
                t,
                before,
                e.road_speed() * 3.6
            );
        }
        if t >= next {
            println!(
                "t={t:5.1}s gear={} rpm={:5.0} speed={:5.1} km/h",
                gear + 1,
                e.rpm(),
                e.road_speed() * 3.6
            );
            next += 4.0;
        }
    }
    println!("\nfinite audio: {}", out.iter().all(|s| s.is_finite()));
}
