//! Tests for the `.mr` reader.

use super::load;
use crate::units::{to_rpm, CC, DEG, MM, PI, THOU};

/// A complete engine exercising every construct the stock files lean on:
/// imports, units, labels, a private node with inputs and an alias output,
/// method chains, forward references and named arguments.
const TWIN: &str = r#"
    import "engine_sim.mr"
    units units()

    private node twin_head {
        input intake_camshaft;
        input exhaust_camshaft;
        alias output __out: head;

        function intake_flow(50 * units.thou)
        intake_flow.add_flow_sample(0, 0).add_flow_sample(200, 90)

        function exhaust_flow(50 * units.thou)
        exhaust_flow.add_flow_sample(0, 0).add_flow_sample(200, 70)

        generic_cylinder_head head(
            chamber_volume: 50 * units.cc,
            intake_port_flow: intake_flow,
            exhaust_port_flow: exhaust_flow,
            valvetrain: standard_valvetrain(
                intake_camshaft: intake_camshaft,
                exhaust_camshaft: exhaust_camshaft))
    }

    private node wires {
        output a: ignition_wire();
        output b: ignition_wire();
    }

    private node twin_cam {
        output intake: ic;
        output exhaust: ec;

        harmonic_cam_lobe lobe(duration_at_50_thou: 220 * units.deg,
                               gamma: 0.9, lift: 400 * units.thou, steps: 100)
        camshaft_parameters params(advance: 0 * units.deg, base_radius: 1 * units.inch)
        camshaft ic(params, lobe_profile: lobe)
        camshaft ec(params, lobe_profile: lobe)
        ic.add_lobe(360 * units.deg + 110 * units.deg)
        ec.add_lobe(360 * units.deg - 110 * units.deg)
    }

    public node main {
        engine engine(name: "Twin", redline: 8000 * units.rpm)

        label stroke(86 * units.mm)
        label rod(143 * units.mm)
        label ch(1 * units.inch)

        crankshaft c0(throw: stroke / 2, moment_of_inertia: 0.25,
                      friction_torque: 10 * units.lb_ft)
        rod_journal rj0(angle: 0 * units.deg)
        rod_journal rj1(angle: 180 * units.deg)
        c0.add_rod_journal(rj0).add_rod_journal(rj1)

        piston_parameters pp(mass: 300 * units.g, compression_height: ch)
        connecting_rod_parameters crp(mass: 300 * units.g, length: rod)
        intake intake(plenum_volume: 2 * units.L)
        exhaust_system exhaust(length: 2 * units.m, audio_volume: 0.2)

        cylinder_bank_parameters bp(bore: 86 * units.mm,
                                    deck_height: stroke / 2 + rod + ch)
        cylinder_bank b0(bp, angle: 0)
        b0.add_cylinder(piston: piston(pp), connecting_rod: connecting_rod(crp),
                        rod_journal: rj0, intake: intake, exhaust_system: exhaust,
                        ignition_wire: w.a)
          .add_cylinder(piston: piston(pp), connecting_rod: connecting_rod(crp),
                        rod_journal: rj1, intake: intake, exhaust_system: exhaust,
                        ignition_wire: w.b)
          .set_cylinder_head(twin_head(intake_camshaft: cam.intake,
                                       exhaust_camshaft: cam.exhaust))

        engine.add_cylinder_bank(b0)
        engine.add_crankshaft(c0)

        // Declared after the cylinder bank that already used them: the stock
        // files do this, so the evaluator has to resolve on demand.
        wires w()
        twin_cam cam()

        function timing(1000 * units.rpm)
        timing.add_sample(0, 15 * units.deg).add_sample(8000 * units.rpm, 35 * units.deg)

        ignition_module im(timing_curve: timing, rev_limit: 8000 * units.rpm)
        im.connect_wire(w.a, 0 * units.deg).connect_wire(w.b, 540 * units.deg)
        engine.add_ignition_module(im)

        set_engine(engine)
    }
"#;

#[test]
fn reads_a_complete_engine() {
    let loaded = load(TWIN).expect("should load");
    let cfg = &loaded.config;

    assert_eq!(cfg.name, "Twin");
    assert_eq!(cfg.cylinders.len(), 2);
    assert_eq!(cfg.banks.len(), 1);
    assert_eq!(cfg.exhausts.len(), 1, "both cylinders share one exhaust");
    assert_eq!(cfg.intakes.len(), 1);

    assert!((cfg.bore / MM - 86.0).abs() < 1e-9);
    assert!((cfg.crank_throw * 2.0 / MM - 86.0).abs() < 1e-9);
    assert!((cfg.rod_length / MM - 143.0).abs() < 1e-9);
    assert!((cfg.chamber_volume / CC - 50.0).abs() < 1e-9);
    assert!((to_rpm(cfg.rev_limit) - 8000.0).abs() < 1.0);

    // Straight from the ignition wiring: a 180-degree crank twin fires at
    // 0 and 540, which is exactly what the file says.
    let mut angles: Vec<f64> = cfg
        .cylinders
        .iter()
        .map(|c| (c.ignition_angle / DEG).round())
        .collect();
    angles.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert_eq!(angles, vec![0.0, 540.0]);

    // Journal angles came from the rod journal each cylinder names.
    let journals: Vec<f64> = cfg
        .cylinders
        .iter()
        .map(|c| (c.journal_angle / DEG).round())
        .collect();
    assert_eq!(journals, vec![0.0, 180.0]);
}

#[test]
fn a_loaded_engine_runs() {
    let loaded = load(TWIN).unwrap();
    let mut engine = crate::sim::SoundEngine::new(loaded.config, 44100.0);
    engine.set_starter(true);
    engine.set_throttle(0.5);

    let mut out = vec![0.0f32; 512];
    let mut t = 0.0;
    while t < 6.0 {
        engine.render(&mut out);
        t += 512.0 / 44100.0;
        assert!(out.iter().all(|s| s.is_finite()));
    }
    assert!(engine.rpm() > 0.0, "never turned over");
}

#[test]
fn port_flow_and_cam_profiles_come_from_the_file() {
    let cfg = load(TWIN).unwrap().config;

    // `add_flow_sample` takes thou and SCFM, so 200 thou should flow, and the
    // exhaust side should flow less than the intake.
    let lift = 200.0 * THOU;
    let intake = cfg.intake_port_flow.sample_triangle(lift);
    let exhaust = cfg.exhaust_port_flow.sample_triangle(lift);
    assert!(intake > 0.0);
    assert!(exhaust > 0.0 && exhaust < intake);

    // The harmonic lobe peaks at its nose and is shut a long way from it.
    let peak = cfg.intake_lobe_profile.sample_triangle(0.0);
    assert!(peak > 0.9 * 400.0 * THOU, "peak lift {peak}");
    assert!(cfg.intake_lobe_profile.sample_triangle(PI) < peak * 1e-3);
}

#[test]
fn units_and_arithmetic_match_the_language() {
    let cfg = load(TWIN).unwrap().config;
    // deck_height was written as `stroke / 2 + rod + ch`.
    let expected = 43.0 * MM + 143.0 * MM + 25.4 * MM;
    assert!(
        (cfg.deck_height - expected).abs() < 1e-6,
        "{} vs {expected}",
        cfg.deck_height
    );
}

#[test]
fn reports_what_it_cannot_do_rather_than_failing() {
    // Without an ignition module the firing order cannot be read off the
    // wiring, but the engine should still load.
    let source = TWIN.replace("engine.add_ignition_module(im)", "").replace(
        "im.connect_wire(w.a, 0 * units.deg).connect_wire(w.b, 540 * units.deg)",
        "",
    );
    let loaded = load(&source).expect("should still load");
    assert!(
        loaded.warnings.iter().any(|w| w.contains("ignition")),
        "expected a warning about the ignition module, got {:?}",
        loaded.warnings
    );
    assert_eq!(loaded.config.cylinders.len(), 2);
}

#[test]
fn explains_what_is_wrong_with_a_bad_file() {
    assert!(load("").is_err());
    assert!(load("public node main { this is not valid").is_err());

    let no_engine = load("import \"engine_sim.mr\"\npublic node main { }").unwrap_err();
    assert!(
        no_engine.message.contains("set_engine"),
        "unhelpful message: {}",
        no_engine.message
    );

    let undefined =
        load("import \"engine_sim.mr\"\npublic node main { set_engine(nonexistent_engine()) }")
            .unwrap_err();
    assert!(
        undefined.message.contains("nonexistent_engine"),
        "unhelpful message: {}",
        undefined.message
    );
}

#[test]
fn a_cycle_is_reported_rather_than_hanging() {
    let source = "import \"engine_sim.mr\"\n\
         public node main { label a(b) label b(a) set_engine(a) }";
    let err = load(source).unwrap_err();
    assert!(
        err.message.contains("itself") || err.message.contains("deep"),
        "unhelpful message: {}",
        err.message
    );
}

#[test]
fn a_file_with_no_main_can_still_expose_an_engine() {
    // Several stock files are written as libraries: no `main`, just a public
    // node returning an engine for the application to pick.
    let source = TWIN
        .replace("public node main {", "public node my_engine {")
        .replace(
            "        set_engine(engine)\n",
            "        alias output __out: engine;\n",
        );
    let loaded = load(&source).expect("should load from a public node");
    assert_eq!(loaded.config.cylinders.len(), 2);
}

#[test]
fn accepts_the_newer_run_entry_point() {
    // Later engine-sim releases replaced set_engine/set_vehicle/set_transmission
    // with a single `run`. A file written against one of those should load.
    let source = TWIN.replace(
        "        set_engine(engine)
",
        "        run(engine: engine, vehicle: 0, transmission: 0)
",
    );
    assert!(
        source.contains("run(engine:"),
        "the substitution did not apply"
    );

    let loaded = load(&source).expect("a file using `run` should load");
    assert_eq!(loaded.config.cylinders.len(), 2);
    assert_eq!(loaded.config.name, "Twin");
}

#[test]
fn run_works_with_only_an_engine() {
    let source = TWIN.replace(
        "        set_engine(engine)
",
        "        run(engine)
",
    );
    let loaded = load(&source).expect("`run` should accept just an engine");
    assert_eq!(loaded.config.cylinders.len(), 2);
}

#[test]
fn an_unknown_node_says_what_might_be_wrong() {
    let source = TWIN.replace(
        "        set_engine(engine)
",
        "        set_engine(engine)
        something_from_the_future()
",
    );
    let err = load(&source).unwrap_err();
    assert!(err.message.contains("something_from_the_future"));
    assert!(
        err.message.contains("newer engine-sim") && err.message.contains("imports another"),
        "the message should suggest both causes: {}",
        err.message
    );
    // No stray whitespace from wrapping the literal across lines.
    assert!(
        !err.message.contains("  "),
        "the message has run-together spacing: {}",
        err.message
    );
}

/// The Fiat 500 written out as an engine-sim file, shipped with the demo.
const FIAT_500_MR: &str = include_str!("../../js/demo/fiat-500l.mr");

#[test]
fn the_fiat_500_file_reproduces_the_preset() {
    // The file and the preset are two descriptions of one engine. If either
    // moves without the other, this is where it shows up.
    let loaded = load(FIAT_500_MR).expect("the shipped .mr file should load");
    let from_file = &loaded.config;
    let preset = crate::config::Preset::Fiat500.config();

    let close = |a: f64, b: f64| {
        if b.abs() > 1e-12 {
            ((a - b) / b).abs() < 1e-6
        } else {
            (a - b).abs() < 1e-12
        }
    };

    let scalars: &[(&str, f64, f64)] = &[
        ("bore", from_file.bore, preset.bore),
        ("crank throw", from_file.crank_throw, preset.crank_throw),
        ("rod length", from_file.rod_length, preset.rod_length),
        (
            "compression height",
            from_file.compression_height,
            preset.compression_height,
        ),
        ("deck height", from_file.deck_height, preset.deck_height),
        (
            "chamber volume",
            from_file.chamber_volume,
            preset.chamber_volume,
        ),
        (
            "moment of inertia",
            from_file.moment_of_inertia,
            preset.moment_of_inertia,
        ),
        (
            "friction torque",
            from_file.friction_torque,
            preset.friction_torque,
        ),
        (
            "windage",
            from_file.windage_coefficient,
            preset.windage_coefficient,
        ),
        ("rev limit", from_file.rev_limit, preset.rev_limit),
        (
            "intake runner volume",
            from_file.intake_runner_volume,
            preset.intake_runner_volume,
        ),
        (
            "intake runner area",
            from_file.intake_runner_cross_section_area,
            preset.intake_runner_cross_section_area,
        ),
        (
            "exhaust runner volume",
            from_file.exhaust_runner_volume,
            preset.exhaust_runner_volume,
        ),
        (
            "exhaust runner area",
            from_file.exhaust_runner_cross_section_area,
            preset.exhaust_runner_cross_section_area,
        ),
        (
            "intake lobe centre",
            from_file.intake_lobe_center,
            preset.intake_lobe_center,
        ),
        (
            "exhaust lobe centre",
            from_file.exhaust_lobe_center,
            preset.exhaust_lobe_center,
        ),
        ("blowby", from_file.blowby_k, preset.blowby_k),
    ];

    for (name, from_file_value, preset_value) in scalars {
        assert!(
            close(*from_file_value, *preset_value),
            "{name} differs: {from_file_value} vs {preset_value}"
        );
    }

    assert!(close(from_file.displacement(), preset.displacement()));
    assert_eq!(from_file.cylinders.len(), preset.cylinders.len());
    assert_eq!(from_file.banks.len(), preset.banks.len());
    assert_eq!(from_file.exhausts.len(), preset.exhausts.len());
    assert_eq!(from_file.intakes.len(), preset.intakes.len());

    let intake = (&from_file.intakes[0], &preset.intakes[0]);
    assert!(close(intake.0.plenum_volume, intake.1.plenum_volume));
    assert!(close(intake.0.input_flow_k, intake.1.input_flow_k));
    assert!(close(intake.0.runner_flow_rate, intake.1.runner_flow_rate));
    assert!(close(
        intake.0.idle_throttle_plate_position,
        intake.1.idle_throttle_plate_position
    ));

    let exhaust = (&from_file.exhausts[0], &preset.exhausts[0]);
    assert!(close(exhaust.0.length, exhaust.1.length));
    assert!(close(exhaust.0.audio_volume, exhaust.1.audio_volume));
    assert!(close(
        exhaust.0.collector_cross_section_area,
        exhaust.1.collector_cross_section_area
    ));

    // A 360 degree crank: one revolution apart.
    let angles = |c: &crate::config::EngineConfig| -> Vec<i64> {
        let mut a: Vec<i64> = c
            .cylinders
            .iter()
            .map(|x| (x.ignition_angle / DEG).round() as i64)
            .collect();
        a.sort();
        a
    };
    assert_eq!(angles(from_file), vec![0, 360]);
    assert_eq!(angles(from_file), angles(&preset));

    // Curves, not just scalars.
    for lift_thou in [50.0, 150.0, 250.0] {
        let lift = lift_thou * THOU;
        assert!(close(
            from_file.intake_port_flow.sample_triangle(lift),
            preset.intake_port_flow.sample_triangle(lift)
        ));
        assert!(close(
            from_file.exhaust_port_flow.sample_triangle(lift),
            preset.exhaust_port_flow.sample_triangle(lift)
        ));
    }
    assert!(close(
        from_file.intake_lobe_profile.sample_triangle(0.0),
        preset.intake_lobe_profile.sample_triangle(0.0)
    ));
}

#[test]
fn the_fiat_500_file_runs() {
    let loaded = load(FIAT_500_MR).unwrap();
    let mut engine = crate::sim::SoundEngine::new(loaded.config, 44100.0);
    engine.set_starter(true);
    engine.set_throttle(0.0);
    engine.set_load_torque(4.0);

    let mut out = vec![0.0f32; 512];
    let mut t = 0.0;
    while t < 14.0 {
        engine.render(&mut out);
        t += 512.0 / 44100.0;
    }
    let idle = engine.rpm();
    assert!((600.0..1200.0).contains(&idle), "idle {idle} rpm");
    assert!(out.iter().all(|s| s.is_finite()));
}
