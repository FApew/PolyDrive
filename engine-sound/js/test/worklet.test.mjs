/**
 * Drives the real AudioWorkletProcessor source under a stub of the worklet
 * global scope. Node has no Web Audio, but the processor only needs
 * `AudioWorkletProcessor`, `registerProcessor`, `sampleRate` and a MessagePort,
 * so this exercises the whole wasm ABI path exactly as a browser would.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { WORKLET_SOURCE } from '../src/worklet-source.js';
import { buildSpec } from '../src/spec.js';
// Imported directly rather than through the package entry point: that also
// exports the React hook, and this test has no React dependency.
import { AUDIO_KEYS, CONFIG_KEYS, PRESETS, kCarb, k28inH2O } from '../src/constants.js';
import { deg } from '../src/spec.js';

const SAMPLE_RATE = 44100;

const wasmBytes = await readFile(
  fileURLToPath(new URL('../src/engine_sound.wasm', import.meta.url)),
);

/** Instantiates the processor with a fake worklet global scope. */
function createHarness(spec, { sampleRate = SAMPLE_RATE } = {}) {
  const outbox = [];
  const inbox = [];

  class FakePort {
    constructor() {
      this.onmessage = null;
    }

    // Processor -> main thread.
    postMessage(data) {
      outbox.push(data);
    }

    // Main thread -> processor.
    deliver(data) {
      inbox.push(data);
      if (this.onmessage) this.onmessage({ data });
    }
  }

  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = new FakePort();
    }
  }

  let ProcessorClass = null;
  const registerProcessor = (name, cls) => {
    assert.equal(name, 'engine-sound');
    ProcessorClass = cls;
  };

  // An AudioWorkletGlobalScope is neither a Window nor a WorkerGlobalScope, so
  // it has no TextEncoder or TextDecoder. Node has both as globals, which would
  // let the worklet use them here and fail only in a browser — so they are shut
  // out explicitly.
  // eslint-disable-next-line no-new-func
  const evaluate = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    'TextEncoder',
    'TextDecoder',
    'fetch',
    'window',
    'document',
    WORKLET_SOURCE,
  );
  const forbidden = (name) => () => {
    throw new ReferenceError(`${name} is not defined in an AudioWorkletGlobalScope`);
  };
  evaluate(
    FakeAudioWorkletProcessor,
    registerProcessor,
    sampleRate,
    forbidden('TextEncoder'),
    forbidden('TextDecoder'),
    forbidden('fetch'),
    undefined,
    undefined,
  );

  assert.ok(ProcessorClass, 'worklet did not register a processor');

  const processor = new ProcessorClass({
    processorOptions: {
      // The processor calls `new WebAssembly.Module(bytes)`, which accepts a
      // TypedArray or ArrayBuffer, same as in the browser.
      wasm: wasmBytes,
      spec,
    },
  });

  const render = (frames = 128, channels = 2) => {
    const output = Array.from({ length: channels }, () => new Float32Array(frames));
    processor.process([], [output], {});
    return output;
  };

  return { processor, outbox, inbox, render, send: (m) => processor.port.deliver(m) };
}

const decoder = new TextDecoder();

/** Applies the same decoding the main-thread class does. */
function messagesOfType(outbox, type) {
  return outbox
    .filter((m) => m.type === type)
    .map((m) => {
      if (type === 'engine') {
        return {
          ...m,
          name: m.nameBytes ? decoder.decode(m.nameBytes) : '',
          warnings: m.warningsJson && m.warningsJson.length
            ? JSON.parse(decoder.decode(m.warningsJson))
            : [],
        };
      }
      if (type === 'telemetry') {
        // The ABI uses -1 for neutral; callers see 1-based gears with 0 for
        // neutral, and the main-thread class does the conversion.
        return { ...m, gear: m.gear < 0 ? 0 : m.gear + 1 };
      }
      if (type === 'error' && m.messageBytes) {
        return { ...m, message: decoder.decode(m.messageBytes) };
      }
      return m;
    });
}

test('worklet instantiates the wasm and reports the engine it built', () => {
  const { outbox } = createHarness(buildSpec({ preset: 'v8_crossplane' }));

  const errors = messagesOfType(outbox, 'error');
  assert.deepEqual(errors, [], `worklet reported errors: ${JSON.stringify(errors)}`);

  assert.equal(messagesOfType(outbox, 'ready').length, 1);

  const [engine] = messagesOfType(outbox, 'engine');
  assert.ok(engine, 'no engine message');
  assert.equal(engine.cylinders, 8);
  assert.equal(engine.channels, 2);
  // A preset is not a loaded file, and the demo keys its UI off this.
  assert.equal(engine.source, 'spec');
  assert.equal(engine.name, '90° V8 (crossplane)');
  assert.equal(engine.banks, 2);
  assert.deepEqual(engine.warnings, []);
});

test('the JS preset table lines up with the Rust one', () => {
  // PRESETS is positional: its index is the id sent to wasm. If the two lists
  // ever drift, every name after the insertion point silently builds the wrong
  // engine, so pin each one to something observable.
  const expected = {
    single: { cylinders: 1, exhausts: 1 },
    inline2: { cylinders: 2, exhausts: 1 },
    v_twin: { cylinders: 2, exhausts: 2 },
    inline3: { cylinders: 3, exhausts: 1 },
    inline4: { cylinders: 4, exhausts: 1 },
    flat4: { cylinders: 4, exhausts: 2 },
    inline5: { cylinders: 5, exhausts: 1 },
    inline6: { cylinders: 6, exhausts: 1 },
    v6: { cylinders: 6, exhausts: 2 },
    flat6: { cylinders: 6, exhausts: 2 },
    v8_crossplane: { cylinders: 8, exhausts: 2 },
    v8_flatplane: { cylinders: 8, exhausts: 2 },
    v10: { cylinders: 10, exhausts: 2 },
    v12: { cylinders: 12, exhausts: 2 },
    fiat500: { cylinders: 2, exhausts: 1 },
  };

  assert.deepEqual(PRESETS, Object.keys(expected), 'preset list changed');

  for (const preset of PRESETS) {
    const { outbox } = createHarness(buildSpec({ preset }));
    const [engine] = messagesOfType(outbox, 'engine');
    assert.ok(engine, `${preset} built no engine`);
    assert.equal(engine.cylinders, expected[preset].cylinders, `${preset} cylinder count`);
    assert.equal(engine.channels, expected[preset].exhausts, `${preset} exhaust count`);
  }

  // inline6 and v6 both have six cylinders; separate them by exhaust count, and
  // separate v6 from flat6 by bank angle, which shows up in the firing pattern.
  assert.notEqual(
    PRESETS.indexOf('v6'),
    PRESETS.indexOf('flat6'),
    'v6 and flat6 must be distinct presets',
  );
});

test('displacement is derived from bore, stroke and cylinder count', () => {
  // There is no displacement input — in the original either. Check the number
  // that comes back is the swept volume implied by the geometry.
  const cases = [
    // preset, bore m, stroke m, cylinders
    ['inline2', 0.08, 0.0686, 2],
    ['inline4', 0.086, 0.086, 4],
    ['flat6', 0.1, 0.0764, 6],
    ['v8_crossplane', 0.10325, 0.092, 8],
  ];

  for (const [preset, bore, stroke, cylinders] of cases) {
    const { outbox } = createHarness(buildSpec({ preset }));
    const [engine] = messagesOfType(outbox, 'engine');
    const expected = Math.PI * (bore / 2) ** 2 * stroke * cylinders;
    assert.ok(
      Math.abs(engine.displacement - expected) / expected < 1e-5,
      `${preset}: got ${(engine.displacement * 1000).toFixed(3)} L, expected ${(expected * 1000).toFixed(3)} L`,
    );
  }
});

test('changing bore or stroke changes displacement', () => {
  const base = createHarness(buildSpec({ preset: 'inline4' }));
  const bored = createHarness(
    buildSpec({ preset: 'inline4', params: { bore: 0.1 } }),
  );
  const stroked = createHarness(
    buildSpec({ preset: 'inline4', params: { crankThrow: 0.05 } }),
  );

  const of = (h) => messagesOfType(h.outbox, 'engine')[0].displacement;
  assert.ok(of(bored) > of(base), 'a bigger bore did not raise displacement');
  assert.ok(of(stroked) > of(base), 'a longer stroke did not raise displacement');
});

test('every preset builds and renders finite audio', () => {
  for (const preset of PRESETS) {
    const { outbox, render, send } = createHarness(buildSpec({ preset }));
    assert.deepEqual(
      messagesOfType(outbox, 'error'),
      [],
      `${preset} reported an error`,
    );

    send({ type: 'starter', value: true });
    send({ type: 'throttle', value: 0.5 });

    let last = null;
    for (let i = 0; i < 200; i++) last = render();

    for (const channel of last) {
      for (const sample of channel) {
        assert.ok(Number.isFinite(sample), `${preset} produced a non-finite sample`);
        assert.ok(Math.abs(sample) <= 1, `${preset} produced ${sample}, out of range`);
      }
    }
  }
});

test('the engine starts, idles and responds to throttle', () => {
  const { render, send, outbox } = createHarness(buildSpec({ preset: 'inline4' }));

  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 0 });

  const blocks = Math.round((SAMPLE_RATE * 8) / 128);
  for (let i = 0; i < blocks; i++) render();

  const idle = messagesOfType(outbox, 'telemetry').at(-1);
  assert.ok(idle, 'no telemetry');
  assert.ok(idle.rpm > 400 && idle.rpm < 1600, `implausible idle: ${idle.rpm} rpm`);

  send({ type: 'throttle', value: 1 });
  for (let i = 0; i < Math.round((SAMPLE_RATE * 5) / 128); i++) render();

  const wot = messagesOfType(outbox, 'telemetry').at(-1);
  assert.ok(wot.rpm > idle.rpm * 3, `throttle did nothing: ${idle.rpm} -> ${wot.rpm}`);
});

test('both output channels get the same signal, and it is not silent', () => {
  const { render, send } = createHarness(buildSpec({ preset: 'v8_flatplane' }));
  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 0.6 });

  let energy = 0;
  let last = null;
  for (let i = 0; i < 2000; i++) {
    last = render();
    if (i > 1500) {
      for (const s of last[0]) energy += s * s;
    }
  }

  assert.ok(energy > 0.1, `output is essentially silent (energy ${energy})`);
  assert.deepEqual(Array.from(last[0]), Array.from(last[1]));
});

test('a forced rpm sets the crank speed directly', () => {
  const { render, send, outbox } = createHarness(buildSpec({ preset: 'inline6' }));
  send({ type: 'rpm', value: 4500 });
  send({ type: 'throttle', value: 0.7 });

  for (let i = 0; i < 20; i++) {
    send({ type: 'rpm', value: 4500 });
    render();
  }

  const telemetry = messagesOfType(outbox, 'telemetry').at(-1);
  assert.ok(
    Math.abs(telemetry.rpm - 4500) < 500,
    `expected ~4500 rpm, got ${telemetry.rpm}`,
  );
});

test('impulse responses can be replaced at runtime', () => {
  const { render, send, outbox } = createHarness(buildSpec({ preset: 'v6' }));
  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 0.4 });
  for (let i = 0; i < 500; i++) render();

  // A short decaying response, deliberately different from the default.
  const data = new Float32Array(2048);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.exp(-i / 300) * Math.sin(i * 0.05);
  }
  send({ type: 'impulseResponse', channel: -1, volume: 1, data });

  let last = null;
  for (let i = 0; i < 500; i++) last = render();

  assert.deepEqual(messagesOfType(outbox, 'error'), []);
  assert.ok(last[0].every(Number.isFinite));
  assert.ok(last[0].some((s) => s !== 0), 'no output after swapping the response');
});

test('telemetry reports whether the starter is still cranking', () => {
  const { render, send, outbox } = createHarness(buildSpec({ preset: 'inline4' }));

  const cranking = () => messagesOfType(outbox, 'telemetry').at(-1)?.starterEngaged;
  const run = (seconds) => {
    for (let i = 0; i < Math.round((SAMPLE_RATE * seconds) / 128); i++) render();
  };

  run(0.5);
  assert.equal(cranking(), false, 'cranking before the key was turned');

  send({ type: 'starter', value: true });
  run(0.5);
  assert.equal(cranking(), true, 'no cranking state after engaging the starter');

  // It releases by itself once the engine is running.
  run(9);
  assert.equal(cranking(), false, 'starter never released');
  assert.ok(messagesOfType(outbox, 'telemetry').at(-1).rpm > 400);
});

test('the starter gives up instead of cranking forever', () => {
  // Under a load it cannot overcome, the engine spins at starter speed and
  // never fires. Without a timeout the button looks dead: rpm sits at 300 and
  // nothing the user does changes it.
  const { render, send, outbox } = createHarness(buildSpec({ preset: 'inline4' }));
  send({ type: 'load', value: 400 });
  send({ type: 'starter', value: true });

  for (let i = 0; i < Math.round((SAMPLE_RATE * 15) / 128); i++) render();

  const last = messagesOfType(outbox, 'telemetry').at(-1);
  assert.equal(last.starterEngaged, false, 'starter cranked forever');
  assert.ok(last.rpm < 500, `engine caught anyway at ${last.rpm} rpm`);
});

test('a bad WAV is reported rather than crashing the audio thread', () => {
  const { render, send, outbox } = createHarness(buildSpec({ preset: 'inline4' }));
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
  send({ type: 'impulseResponseWav', channel: -1, volume: 1, bytes });

  const errors = messagesOfType(outbox, 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /WAV/);

  const [output] = render();
  assert.ok(output.every(Number.isFinite));
});

test('a custom layout with its own firing order runs', () => {
  const spec = buildSpec({
    preset: 'inline4',
    layout: {
      banks: [deg(30), deg(-30)],
      exhausts: [
        { length: 2.2, audioVolume: 0.22 },
        { length: 2.4, audioVolume: 0.2 },
      ],
      cylinders: [
        { bank: 0, journalAngle: deg(0), exhaust: 0, headerPrimaryLength: 0.02 },
        { bank: 0, journalAngle: deg(120), exhaust: 0, headerPrimaryLength: 0.04 },
        { bank: 0, journalAngle: deg(240), exhaust: 0, headerPrimaryLength: 0.01 },
        { bank: 1, journalAngle: deg(300), exhaust: 1, headerPrimaryLength: 0.03 },
        { bank: 1, journalAngle: deg(60), exhaust: 1, headerPrimaryLength: 0.05 },
        { bank: 1, journalAngle: deg(180), exhaust: 1, headerPrimaryLength: 0.02 },
      ],
    },
    firingOrder: [0, 4, 2, 3, 1, 5],
    params: { bore: 0.089, crankThrow: 0.0395, revLimit: 7000 * 0.104719755 },
  });

  const { outbox, render, send } = createHarness(spec);
  assert.deepEqual(messagesOfType(outbox, 'error'), []);

  const [engine] = messagesOfType(outbox, 'engine');
  assert.equal(engine.cylinders, 6);
  assert.equal(engine.channels, 2);

  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 0.5 });
  let last = null;
  for (let i = 0; i < 800; i++) last = render();
  assert.ok(last[0].every(Number.isFinite));
});

test('the JS flow-constant helpers agree with the wasm ones', () => {
  // `kCarb`/`k28inH2O` are reimplemented in JS so a spec can be written before
  // the wasm has loaded. If they drift from the Rust versions, every custom
  // engine breathes wrong.
  const { outbox } = createHarness(buildSpec({ preset: 'inline4' }));
  assert.deepEqual(messagesOfType(outbox, 'error'), []);

  const wasm = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}).exports;

  for (const scfm of [0.5, 12, 42, 100, 700, 2000]) {
    const carb = wasm.es_k_carb(scfm);
    const bench = wasm.es_k_28in_h2o(scfm);
    assert.ok(
      Math.abs(kCarb(scfm) - carb) / carb < 1e-9,
      `kCarb(${scfm}): ${kCarb(scfm)} vs ${carb}`,
    );
    assert.ok(
      Math.abs(k28inH2O(scfm) - bench) / bench < 1e-9,
      `k28inH2O(${scfm}): ${k28inH2O(scfm)} vs ${bench}`,
    );
  }
});

test('the fiat500 preset matches its published figures', () => {
  const { outbox, render, send } = createHarness(buildSpec({ preset: 'fiat500' }));
  assert.deepEqual(messagesOfType(outbox, 'error'), []);

  const [engine] = messagesOfType(outbox, 'engine');
  assert.equal(engine.cylinders, 2);
  assert.equal(engine.channels, 1);
  assert.ok(
    Math.abs(engine.displacement * 1e6 - 499.5) < 0.5,
    `${(engine.displacement * 1e6).toFixed(1)} cc`,
  );

  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 0 });
  send({ type: 'load', value: 4 });
  for (let i = 0; i < Math.round((SAMPLE_RATE * 14) / 128); i++) render();

  const idle = messagesOfType(outbox, 'telemetry').at(-1).rpm;
  assert.ok(idle > 600 && idle < 1200, `idle ${idle.toFixed(0)} rpm`);

  send({ type: 'throttle', value: 1 });
  send({ type: 'load', value: 14 });
  for (let i = 0; i < Math.round((SAMPLE_RATE * 14) / 128); i++) render();

  // Breathing-limited: it should run out of puff below the 5400 rpm limiter.
  const peak = messagesOfType(outbox, 'telemetry').at(-1).rpm;
  assert.ok(peak > 4000 && peak < 5400, `wide open throttle ${peak.toFixed(0)} rpm`);
});

test('the hand-built Fiat example reproduces the preset', async () => {
  // `js/examples/fiat500.js` is the worked example for building an engine from
  // scratch — custom layout, port flow curves, carburettor constant. It has to
  // keep producing the same engine the built-in preset does, or it is teaching
  // the wrong thing.
  const { FIAT_500_L } = await import('../examples/fiat500.js');

  const run = (spec) => {
    const h = createHarness(spec);
    assert.deepEqual(messagesOfType(h.outbox, 'error'), []);
    h.send({ type: 'starter', value: true });
    h.send({ type: 'throttle', value: 0 });
    h.send({ type: 'load', value: 4 });
    for (let i = 0; i < Math.round((SAMPLE_RATE * 14) / 128); i++) h.render();
    const built = messagesOfType(h.outbox, 'engine')[0];
    return { ...built, idle: messagesOfType(h.outbox, 'telemetry').at(-1).rpm };
  };

  const preset = run(buildSpec({ preset: 'fiat500' }));
  const handBuilt = run(buildSpec(FIAT_500_L));

  assert.equal(handBuilt.cylinders, preset.cylinders);
  assert.equal(handBuilt.channels, preset.channels);
  assert.ok(
    Math.abs(handBuilt.displacement - preset.displacement) / preset.displacement < 1e-6,
    'displacement differs',
  );
  assert.ok(
    Math.abs(handBuilt.idle - preset.idle) / preset.idle < 0.1,
    `idle differs: ${handBuilt.idle.toFixed(0)} vs ${preset.idle.toFixed(0)} rpm`,
  );
});

test('an .mr file can be loaded through the worklet', () => {
  const source = `
    import "engine_sim.mr"
    units units()
    public node main {
        engine engine(name: "test", starter_torque: 200 * units.lb_ft)
        crankshaft c0(throw: 43 * units.mm, moment_of_inertia: 0.25,
                      friction_torque: 10 * units.lb_ft)
        rod_journal rj0(angle: 0 * units.deg)
        rod_journal rj1(angle: 180 * units.deg)
        c0.add_rod_journal(rj0).add_rod_journal(rj1)

        piston_parameters pp(mass: 300 * units.g, compression_height: 1 * units.inch)
        connecting_rod_parameters crp(mass: 300 * units.g, length: 143 * units.mm)
        intake intake(plenum_volume: 2 * units.L, intake_flow_rate: k_carb(200.0),
                      idle_throttle_plate_position: 0.996)
        exhaust_system exhaust(length: 2 * units.m, audio_volume: 0.2,
                               outlet_flow_rate: k_carb(300.0))
        cylinder_bank_parameters bp(bore: 86 * units.mm,
                                    deck_height: 43 * units.mm + 143 * units.mm + 1 * units.inch)
        cylinder_bank b0(bp, angle: 0)
        b0.add_cylinder(piston: piston(pp), connecting_rod: connecting_rod(crp),
                        rod_journal: rj0, intake: intake, exhaust_system: exhaust)
          .add_cylinder(piston: piston(pp), connecting_rod: connecting_rod(crp),
                        rod_journal: rj1, intake: intake, exhaust_system: exhaust)
        engine.add_cylinder_bank(b0)
        engine.add_crankshaft(c0)
        set_engine(engine)
    }`;

  const { outbox, render, send } = createHarness(buildSpec({ preset: 'inline4' }));
  send({ type: 'mr', source: new TextEncoder().encode(source) });

  assert.deepEqual(messagesOfType(outbox, 'error'), []);

  const built = messagesOfType(outbox, 'engine').at(-1);
  assert.equal(built.cylinders, 2);
  // 86 mm bore, 86 mm stroke, two cylinders.
  const expected = Math.PI * 0.043 ** 2 * 0.086 * 2;
  assert.ok(
    Math.abs(built.displacement - expected) / expected < 1e-5,
    `${(built.displacement * 1e6).toFixed(1)} cc`,
  );

  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 0.5 });
  let last = null;
  for (let i = 0; i < 400; i++) last = render();
  assert.ok(last[0].every(Number.isFinite));
});

test('warnings from an .mr file reach the main thread', async () => {
  // This file asks for two things the port cannot reproduce: a separate head
  // per bank, and impulse responses from the original's sound library.
  const source = await readFile(
    fileURLToPath(new URL('./fixtures/f136_v8.mr', import.meta.url)),
    'utf8',
  );

  const { outbox } = createHarness(buildSpec({ preset: 'inline4' }));
  const before = messagesOfType(outbox, 'engine').length;
  const h = createHarness(buildSpec({ preset: 'inline4' }));
  h.send({ type: 'mr', source: new TextEncoder().encode(source) });

  assert.deepEqual(messagesOfType(h.outbox, 'error'), []);
  const built = messagesOfType(h.outbox, 'engine').at(-1);
  assert.equal(built.cylinders, 8);
  assert.equal(built.channels, 2, 'two banks, two exhaust systems');

  // Characteristics the demo shows in place of the preset picker.
  assert.equal(built.source, 'mr');
  assert.equal(built.name, 'Ferrari F136');
  assert.equal(built.banks, 2);
  assert.ok(
    Math.abs(built.displacement * 1e6 - 4497) < 5,
    `${(built.displacement * 1e6).toFixed(0)} cc`,
  );
  assert.ok(
    built.compressionRatio > 6 && built.compressionRatio < 14,
    `implausible compression ratio ${built.compressionRatio}`,
  );
  assert.ok(
    Math.abs(built.revLimit / 0.104719755 - 9300) < 50,
    `rev limit ${built.revLimit / 0.104719755} rpm`,
  );

  assert.ok(Array.isArray(built.warnings), 'warnings should be an array');
  assert.ok(built.warnings.length >= 2, `expected warnings, got ${JSON.stringify(built.warnings)}`);
  assert.ok(
    built.warnings.some((w) => /cylinder head/i.test(w)),
    'no warning about the shared cylinder head',
  );
  assert.ok(
    built.warnings.some((w) => /impulse response/i.test(w)),
    'no warning about the impulse response',
  );
  assert.equal(before, 1);
});

test('a broken .mr file reports why instead of dying', () => {
  const { outbox, render } = createHarness(buildSpec({ preset: 'inline4' }));

  const cases = [
    ['public node main { syntax error here', /syntax|expected/i],
    ['import "engine_sim.mr" public node main { }', /set_engine|engine/i],
    ['', /empty|syntax|engine/i],
  ];

  for (const [source, pattern] of cases) {
    const before = messagesOfType(outbox, 'error').length;
    // eslint-disable-next-line no-loop-func
    createHarnessAndLoad(outbox, source);
    const errors = messagesOfType(outbox, 'error');
    assert.ok(errors.length > before, `no error for: ${source.slice(0, 30)}`);
    assert.match(errors.at(-1).message, pattern);
  }

  // The audio thread is still alive.
  const [output] = render();
  assert.ok(output.every(Number.isFinite));

  function createHarnessAndLoad(box, src) {
    const h = createHarness(buildSpec({ preset: 'inline4' }));
    h.send({ type: 'mr', source: new TextEncoder().encode(src) });
    for (const m of h.outbox.filter((m) => m.type === 'error')) box.push(m);
  }
});

test('gears load the engine and drive the car', () => {
  const { outbox, render, send } = createHarness(buildSpec({ preset: 'v8_crossplane' }));

  const built = messagesOfType(outbox, 'engine').at(-1);
  assert.ok(built.gears >= 4, `expected a gearbox, got ${built.gears} gears`);

  const telemetry = () => messagesOfType(outbox, 'telemetry').at(-1);
  const run = (seconds) => {
    for (let i = 0; i < Math.round((SAMPLE_RATE * seconds) / 128); i++) render();
  };

  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 0 });
  run(8);

  // Neutral: revs freely, car stays put.
  assert.equal(telemetry().gear, 0);
  assert.equal(telemetry().speed, 0);

  // First gear at full throttle: it pulls away.
  send({ type: 'gear', value: 0 });
  send({ type: 'throttle', value: 1 });
  run(6);

  const moving = telemetry();
  assert.equal(moving.gear, 1, 'gears are 1-based on the way out');
  assert.ok(moving.speed > 3, `did not pull away: ${moving.speed} m/s`);
  assert.ok(moving.rpm > 2000, `did not rev: ${moving.rpm} rpm`);

  // Shifting up drops the revs but keeps the road speed. Lift for the change,
  // as a driver does — at full throttle the engine climbs back up again before
  // the shift can be observed.
  const before = telemetry();
  send({ type: 'throttle', value: 0 });
  send({ type: 'gear', value: 3 });
  run(1.5);
  const after = telemetry();

  assert.ok(
    after.rpm < before.rpm * 0.7,
    `revs did not drop on the upshift: ${before.rpm} -> ${after.rpm}`,
  );
  assert.ok(
    after.speed > before.speed * 0.8,
    `the car lost its speed in the shift: ${before.speed} -> ${after.speed}`,
  );
  assert.equal(after.gear, 4);
});

test('a taller gear holds the engine down', () => {
  // The same throttle in a taller gear should not reach the same revs.
  const revsAfter = (gear) => {
    const h = createHarness(buildSpec({ preset: 'v8_crossplane' }));
    h.send({ type: 'starter', value: true });
    h.send({ type: 'throttle', value: 0 });
    for (let i = 0; i < Math.round((SAMPLE_RATE * 8) / 128); i++) h.render();
    h.send({ type: 'gear', value: gear });
    h.send({ type: 'throttle', value: 1 });
    for (let i = 0; i < Math.round((SAMPLE_RATE * 6) / 128); i++) h.render();
    return messagesOfType(h.outbox, 'telemetry').at(-1).rpm;
  };

  const first = revsAfter(0);
  const top = revsAfter(4);
  assert.ok(first > top * 1.3, `first ${first} rpm vs top ${top} rpm`);
});

test('neutral lets the car coast and the engine spin free', () => {
  const { outbox, render, send } = createHarness(buildSpec({ preset: 'inline4' }));
  const telemetry = () => messagesOfType(outbox, 'telemetry').at(-1);
  const run = (seconds) => {
    for (let i = 0; i < Math.round((SAMPLE_RATE * seconds) / 128); i++) render();
  };

  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 1 });
  send({ type: 'gear', value: 0 });
  run(10);
  const rolling = telemetry().speed;
  assert.ok(rolling > 2, `never got going: ${rolling} m/s`);

  // Out of gear and off the throttle it slows down.
  send({ type: 'gear', value: -1 });
  send({ type: 'throttle', value: 0 });
  run(8);
  const coasting = telemetry();
  assert.equal(coasting.gear, 0, 'should be in neutral');
  assert.ok(coasting.speed < rolling, `did not coast down: ${rolling} -> ${coasting.speed}`);
  assert.ok(coasting.speed >= 0, 'rolled backwards');
});

test('an engine can be defined entirely as JSON data', () => {
  // The shape a game would ship: no code, no .mr, just a data file. If this
  // stops surviving a JSON round-trip, engines can no longer live in content.
  const definition = {
    preset: 'inline4',
    params: {
      bore: 0.086,
      crankThrow: 0.043,
      rodLength: 0.143,
      revLimit: 7000 * 0.104719755,
      chamberVolume: 45e-6,
    },
    cam: { intakeDuration: 240 * (Math.PI / 180), intakeLift: 0.0115 },
    portFlow: {
      intake: [[0, 0], [0.00127, 40], [0.00635, 190]],
      exhaust: [[0, 0], [0.00127, 30], [0.00635, 140]],
    },
    audio: { volume: 0.8, jitter: 0.2 },
  };

  const revived = JSON.parse(JSON.stringify(definition));
  assert.deepEqual(revived, definition, 'the definition is not plain JSON');

  const { outbox, render, send } = createHarness(buildSpec(revived));
  assert.deepEqual(messagesOfType(outbox, 'error'), []);

  const built = messagesOfType(outbox, 'engine').at(-1);
  assert.equal(built.cylinders, 4);
  const expected = Math.PI * 0.043 ** 2 * 0.086 * 4;
  assert.ok(Math.abs(built.displacement - expected) / expected < 1e-5);
  assert.ok(Math.abs(built.revLimit / 0.104719755 - 7000) < 20);

  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 0.5 });
  let last = null;
  for (let i = 0; i < 300; i++) last = render();
  assert.ok(last[0].every(Number.isFinite));
});

test('a full custom layout also survives being JSON', () => {
  const definition = {
    layout: {
      banks: [0.5236, -0.5236],
      exhausts: [{ length: 2.2, audioVolume: 0.22 }, { length: 2.4, audioVolume: 0.2 }],
      cylinders: [
        { bank: 0, journalAngle: 0, exhaust: 0 },
        { bank: 0, journalAngle: 2.0944, exhaust: 0 },
        { bank: 0, journalAngle: 4.1888, exhaust: 0 },
        { bank: 1, journalAngle: 5.236, exhaust: 1 },
        { bank: 1, journalAngle: 1.0472, exhaust: 1 },
        { bank: 1, journalAngle: 3.1416, exhaust: 1 },
      ],
    },
    firingOrder: [0, 4, 2, 3, 1, 5],
  };

  const revived = JSON.parse(JSON.stringify(definition));
  const { outbox } = createHarness(buildSpec(revived));
  assert.deepEqual(messagesOfType(outbox, 'error'), []);
  const built = messagesOfType(outbox, 'engine').at(-1);
  assert.equal(built.cylinders, 6);
  assert.equal(built.banks, 2);
  assert.equal(built.channels, 2);
});

test('the demo JSON engine loads, fires crossplane and runs', async () => {
  // The file shipped with the demo, treated exactly as a game would treat it.
  const json = JSON.parse(
    await readFile(fileURLToPath(new URL('../demo/crossplane-four.json', import.meta.url)), 'utf8'),
  );

  const { outbox, render, send } = createHarness(buildSpec(json));
  assert.deepEqual(messagesOfType(outbox, 'error'), []);

  const built = messagesOfType(outbox, 'engine').at(-1);
  assert.equal(built.name, 'Crossplane Inline Four', 'a JSON engine can name itself');
  assert.equal(built.cylinders, 4);
  assert.equal(built.banks, 1);
  assert.equal(built.channels, 1);
  // 79 x 50.9 mm, four cylinders: 998 cc.
  assert.ok(
    Math.abs(built.displacement * 1e6 - 998) < 3,
    `${(built.displacement * 1e6).toFixed(0)} cc`,
  );

  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 0.4 });
  let last = null;
  for (let i = 0; i < 2000; i++) last = render();

  assert.ok(last[0].every(Number.isFinite));
  const telemetry = messagesOfType(outbox, 'telemetry').at(-1);
  assert.ok(telemetry.rpm > 500, `never ran: ${telemetry.rpm} rpm`);
});

test('the Fiat 500 JSON, .mr file and preset are the same engine', async () => {
  // Three descriptions of one engine, in three formats. If any drifts, this is
  // where it shows up.
  const json = JSON.parse(
    await readFile(fileURLToPath(new URL('../demo/fiat-500l.json', import.meta.url)), 'utf8'),
  );
  const mr = await readFile(
    fileURLToPath(new URL('../demo/fiat-500l.mr', import.meta.url)),
    'utf8',
  );

  const describe = (harness) => {
    assert.deepEqual(messagesOfType(harness.outbox, 'error'), []);
    return messagesOfType(harness.outbox, 'engine').at(-1);
  };

  const fromJson = describe(createHarness(buildSpec(json)));
  const fromPreset = describe(createHarness(buildSpec({ preset: 'fiat500' })));

  const mrHarness = createHarness(buildSpec({ preset: 'inline4' }));
  mrHarness.send({ type: 'mr', source: new TextEncoder().encode(mr) });
  const fromMr = describe(mrHarness);

  for (const [label, built] of [['json', fromJson], ['mr', fromMr]]) {
    assert.equal(built.cylinders, fromPreset.cylinders, `${label}: cylinders`);
    assert.equal(built.banks, fromPreset.banks, `${label}: banks`);
    assert.equal(built.channels, fromPreset.channels, `${label}: exhausts`);
    assert.ok(
      Math.abs(built.displacement - fromPreset.displacement) / fromPreset.displacement < 1e-6,
      `${label}: displacement ${built.displacement} vs ${fromPreset.displacement}`,
    );
    assert.ok(
      Math.abs(built.compressionRatio - fromPreset.compressionRatio) < 0.01,
      `${label}: compression ${built.compressionRatio} vs ${fromPreset.compressionRatio}`,
    );
    assert.ok(
      Math.abs(built.revLimit - fromPreset.revLimit) / fromPreset.revLimit < 1e-4,
      `${label}: rev limit ${built.revLimit} vs ${fromPreset.revLimit}`,
    );
  }

  // 499.5 cc, and the JSON names itself.
  assert.equal(fromJson.name, 'Fiat 500 L (1968)');
  assert.ok(Math.abs(fromJson.displacement * 1e6 - 499.5) < 0.5);
});

test('the Fiat JSON brings its own four-speed gearbox', () => {
  const run = (spec) => {
    const h = createHarness(spec);
    assert.deepEqual(messagesOfType(h.outbox, 'error'), []);
    return { h, built: messagesOfType(h.outbox, 'engine').at(-1) };
  };

  // The preset gets the generic five-speed saloon; the file overrides it.
  const preset = run(buildSpec({ preset: 'fiat500' }));
  assert.equal(preset.built.gears, 5);

  return readFile(
    fileURLToPath(new URL('../demo/fiat-500l.json', import.meta.url)),
    'utf8',
  ).then((text) => {
    const { h, built } = run(buildSpec(JSON.parse(text)));
    assert.equal(built.gears, 4, 'a 500 has four gears');

    // And the gearing reaches the simulation: it pulls away and picks up speed.
    h.send({ type: 'starter', value: true });
    h.send({ type: 'throttle', value: 0 });
    for (let i = 0; i < Math.round((SAMPLE_RATE * 12) / 128); i++) h.render();
    h.send({ type: 'gear', value: 0 });
    h.send({ type: 'throttle', value: 1 });
    for (let i = 0; i < Math.round((SAMPLE_RATE * 10) / 128); i++) h.render();

    const moving = messagesOfType(h.outbox, 'telemetry').at(-1);
    assert.equal(moving.gear, 1);
    assert.ok(moving.speed > 2, `did not pull away: ${moving.speed} m/s`);
  });
});

test('underscore keys are comments, since JSON has none', () => {
  // The demo file leans on this to explain itself.
  const spec = buildSpec({
    preset: 'inline4',
    _comment: 'ignored',
    params: { _why: 'ignored', bore: 0.09 },
    audio: { _note: 'ignored', volume: 0.5 },
  });
  assert.equal(spec.params.length, 1);
  assert.equal(spec.audio.length, 1);

  // A genuine typo is still an error, not silently dropped.
  assert.throws(() => buildSpec({ params: { bore2: 1 } }), /unknown engine parameter/);
});

test('port flow curves actually reach the simulation', () => {
  // Choke the head right down and the same engine must not rev as far.
  const base = buildSpec({ preset: 'inline4' });
  const choked = buildSpec({
    preset: 'inline4',
    portFlow: {
      intake: [[0, 0], [0.006, 8], [0.012, 12]],
      exhaust: [[0, 0], [0.006, 6], [0.012, 9]],
    },
  });

  const run = (spec) => {
    const h = createHarness(spec);
    h.send({ type: 'starter', value: true });
    h.send({ type: 'throttle', value: 1 });
    for (let i = 0; i < Math.round((SAMPLE_RATE * 12) / 128); i++) h.render();
    return messagesOfType(h.outbox, 'telemetry').at(-1).rpm;
  };

  const open = run(base);
  const restricted = run(choked);
  assert.ok(
    restricted < open * 0.8,
    `choking the ports changed nothing: ${open.toFixed(0)} vs ${restricted.toFixed(0)} rpm`,
  );
});

test('audio parameters take effect on the audio thread', () => {
  const { render, send, outbox } = createHarness(buildSpec({ preset: 'v8_crossplane' }));
  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 0.5 });
  for (let i = 0; i < 1500; i++) render();

  const loud = rms(render(128)[0]);

  send({ type: 'audioParam', key: AUDIO_KEYS.volume, value: 0.0 });
  for (let i = 0; i < 50; i++) render();
  const silent = rms(render(128)[0]);

  assert.deepEqual(messagesOfType(outbox, 'error'), []);
  assert.ok(silent < loud * 0.01 + 1e-6, `volume 0 still produced ${silent} vs ${loud}`);
});

test('the engine can be swapped without recreating the node', () => {
  const { send, render, outbox } = createHarness(buildSpec({ preset: 'inline4' }));
  for (let i = 0; i < 20; i++) render();

  send({ type: 'engine', spec: buildSpec({ preset: 'v12' }) });
  for (let i = 0; i < 20; i++) render();

  const engines = messagesOfType(outbox, 'engine');
  assert.equal(engines.length, 2);
  assert.equal(engines[0].cylinders, 4);
  assert.equal(engines[1].cylinders, 12);
  assert.deepEqual(messagesOfType(outbox, 'error'), []);
});

test('rendering keeps up with realtime', () => {
  const { render, send } = createHarness(buildSpec({ preset: 'v8_crossplane' }));
  send({ type: 'starter', value: true });
  send({ type: 'throttle', value: 0.5 });
  for (let i = 0; i < 400; i++) render(); // warm up

  const blocks = Math.round((SAMPLE_RATE * 3) / 128);
  const started = performance.now();
  for (let i = 0; i < blocks; i++) render();
  const elapsed = (performance.now() - started) / 1000;
  const factor = (blocks * 128) / SAMPLE_RATE / elapsed;

  console.log(`    v8 render speed: ${factor.toFixed(2)}x realtime`);
  assert.ok(factor > 1.2, `only ${factor.toFixed(2)}x realtime, too slow for audio`);
});

test('unknown config keys are rejected before they reach the audio thread', () => {
  assert.throws(() => buildSpec({ params: { notAThing: 1 } }), /unknown engine parameter/);
  assert.throws(() => buildSpec({ audio: { nope: 1 } }), /unknown audio parameter/);
  assert.throws(() => buildSpec({ preset: 'w16' }), /unknown preset/);
  assert.ok(CONFIG_KEYS.bore !== undefined);
});

function rms(samples) {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}
