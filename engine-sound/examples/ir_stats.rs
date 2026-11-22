//! Measures the default impulse response: direct-to-reverberant ratio, T60 and
//! the length the synthesizer actually keeps after trimming.

use engine_sound::sim::default_impulse_response;

fn main() {
    let sr = 44100.0f64;
    let ir = default_impulse_response(sr, 0.05);

    let (mut peak, mut peak_at) = (0.0f32, 0usize);
    for (i, s) in ir.iter().enumerate() {
        if s.abs() > peak {
            peak = s.abs();
            peak_at = i;
        }
    }

    let total: f64 = ir.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    let dw = (sr * 0.002) as usize;
    let direct: f64 = ir[..dw].iter().map(|s| (*s as f64) * (*s as f64)).sum();
    let drr = 10.0 * (direct / (total - direct)).log10();

    let thr = 100.0 / 32767.0;
    let last = ir.iter().rposition(|s| s.abs() > thr).unwrap_or(0);

    // Backwards-integrated energy decay curve.
    let mut edc = vec![0.0f64; ir.len()];
    let mut acc = 0.0f64;
    for i in (0..ir.len()).rev() {
        acc += (ir[i] as f64) * (ir[i] as f64);
        edc[i] = acc;
    }
    let find = |x: f64| {
        (0..ir.len())
            .find(|&i| 10.0 * (edc[i] / edc[0]).log10() <= x)
            .map(|i| i as f64 / sr)
            .unwrap_or(f64::NAN)
    };
    let t60 = (find(-25.0) - find(-5.0)) * 3.0;

    println!("taps            {} ({:.0} ms)", ir.len(), ir.len() as f64 / sr * 1000.0);
    println!("ir[0]           {:.3}", ir[0]);
    println!("peak            {:.3} at sample {} ({:.2} ms)", peak, peak_at, peak_at as f64 / sr * 1000.0);
    println!("direct/reverb   {:+.1} dB", drr);
    println!("T60             {:.0} ms", t60 * 1000.0);
    println!("kept after trim {} taps ({:.0} ms)", last + 1, (last + 1) as f64 / sr * 1000.0);
}
