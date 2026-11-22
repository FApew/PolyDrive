// Loads every stock .mr engine file and reports what happened.
use engine_sound::mr;
use engine_sound::sim::SoundEngine;
use engine_sound::units::{to_rpm, CC, DEG};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(es) = fs::read_dir(dir) {
        for e in es.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "mr") {
                out.push(p);
            }
        }
    }
}

fn main() {
    let mut files = Vec::new();
    for root in std::env::args().skip(1) {
        walk(Path::new(&root), &mut files);
    }
    files.sort();

    let (mut ok, mut fail) = (0, 0);
    for f in &files {
        let name = f.file_name().unwrap().to_string_lossy().to_string();
        let src = fs::read_to_string(f).unwrap();
        match mr::load(&src) {
            Ok(loaded) => {
                ok += 1;
                let c = &loaded.config;
                let mut angles: Vec<i64> = c
                    .cylinders
                    .iter()
                    .map(|x| (x.ignition_angle / DEG).round() as i64)
                    .collect();
                angles.sort();
                // Does it actually run?
                let mut e = SoundEngine::new(c.clone(), 44100.0);
                e.set_starter(true);
                e.set_throttle(0.0);
                let mut buf = vec![0.0f32; 512];
                let mut t = 0.0;
                while t < 10.0 {
                    e.render(&mut buf);
                    t += 512.0 / 44100.0;
                }
                let idle = e.rpm();
                e.set_throttle(1.0);
                while t < 18.0 {
                    e.render(&mut buf);
                    t += 512.0 / 44100.0;
                }
                let finite = buf.iter().all(|s| s.is_finite());
                println!("OK   {name:34} {:>2}cyl {:>6.0}cc  redline {:>5.0}  idle {:>5.0}  wot {:>5.0}  finite={finite}  warn={}",
                    c.cylinders.len(), c.displacement()/CC, to_rpm(c.rev_limit), idle, e.rpm(), loaded.warnings.len());
            }
            Err(e) => {
                fail += 1;
                println!("FAIL {name:34} {e}");
            }
        }
    }
    println!("\nloaded {ok}/{}, {fail} failed", files.len());
}
