// Prints each preset's firing pattern: cycle angle per cylinder and which bank.
use engine_sound::config::Preset;
use engine_sound::units::DEG;

fn main() {
    for &preset in Preset::all() {
        let cfg = preset.config();
        let mut events: Vec<(f64, usize, usize)> = cfg
            .cylinders
            .iter()
            .enumerate()
            .map(|(i, c)| (c.ignition_angle / DEG, i, c.bank))
            .collect();
        events.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

        let order: Vec<String> = events.iter().map(|e| format!("{}", e.1)).collect();
        let banks: String = events
            .iter()
            .map(|e| if e.2 == 0 { 'L' } else { 'R' })
            .collect();
        let mut gaps: Vec<f64> = (0..events.len())
            .map(|i| {
                let next = events[(i + 1) % events.len()].0
                    + if i + 1 == events.len() { 720.0 } else { 0.0 };
                next - events[i].0
            })
            .collect();
        gaps.iter_mut().for_each(|g| *g = g.round());

        println!(
            "{:>22}  order {:<32} banks {:<13} gaps {:?}",
            cfg.name,
            order.join("-"),
            banks,
            gaps
        );
    }
}
