# engine-sound

Physically simulated engine sound, in Rust, with a WebAssembly + React front end.

A port of the audio algorithm from [engine-sim](https://github.com/ange-yaghi/engine-sim)
by Ange Yaghi, reduced to the parts that make noise and repackaged so it can run
on a browser audio thread.

No samples, no oscillators. Cylinder pressure, valve timing and exhaust gas
dynamics are integrated at 10 kHz; the pressure waves leaving the exhaust runner
are the audio signal.

```
 crank angle ─► slider-crank ─► cylinder volume ─┐
 cam lobes   ─► valve lift   ─► port flow ───────┤
                                                 ▼
                        gas dynamics (plenum ─ runner ─ cylinder ─ collector)
                                                 │
                     exhaust runner pressure ────┤
                                                 ▼
             delay ─► jitter ─► DC block ─► +derivative ─► ×noise
                                                 │
                                     impulse response convolution
                                                 │
                                     anti-alias ─► auto level ─► out
```

## What you get

| | |
|---|---|
| `engine-sound` (Rust crate) | The simulation, the drivetrain and the whole audio chain. No dependencies. |
| `js/` | WebAssembly build, `AudioWorklet` glue, `EngineSound` class, React hook at `engine-sound/react`. |
| 15 presets | single, parallel twin, V-twin, I3, I4, flat-4, I5, I6, V6, flat-6, crossplane V8, flatplane V8, V10, V12, and a 1968 Fiat 500 L |
| Engines as data | A whole engine, car and gearbox as plain JSON — no code, no parser. |
| A `.mr` reader | Loads engine-sim's own engine files, standard library included. |

Everything is tunable: bore, stroke, rod length, chamber volume, cam duration
and lift, lobe centres, port flow, runner and collector geometry, plenum size,
idle stop, throttle response, ignition timing curve, rev limit, gearing, and the
full audio chain. You can also describe an engine from scratch — banks, journal
angles, exhaust routing and firing order.

The uneven-firing engines get their character from geometry rather than from a
table. A 45° V-twin on a shared crankpin comes out at 315°/405°, a 270° parallel
twin at 270°/450°, a Fiat 500 at a dead-even 360°/360°, and a crossplane V8 at
the lopsided bank pattern that gives it its burble — all derived from journal and
bank angles by `resolve_firing_order`. `cargo run --example firing` prints the lot.

## Rust

```rust
use engine_sound::{config::Preset, sim::SoundEngine};

let mut engine = SoundEngine::from_preset(Preset::V8Crossplane, 44_100.0);
engine.set_starter(true);   // disengages by itself once it catches
engine.set_throttle(0.25);

let mut buffer = vec![0.0f32; 1024];
engine.render(&mut buffer); // mono, -1..1
```

Try it:

```
cargo run --release --example render -- v8_crossplane engine.wav
cargo run --release --example characterize   # start time, idle, WOT, coast-down
cargo run --release --example firing         # firing order, bank pattern, gaps
cargo run --release --example gears          # accelerate through the gearbox
cargo run --release --example fiat500 -- fiat500.wav
cargo run --release --example bench
cargo run --release --example mr_check -- path/to/engines   # load .mr files
```

Building an engine by hand:

```rust
use engine_sound::config::{EngineConfig, Preset};
use engine_sound::units::{DEG, MM};

let mut cfg = Preset::Inline4.config();
cfg.bore = 82.0 * MM;
cfg.crank_throw = 0.5 * 78.0 * MM;
cfg.intake_lobe_center = 108.0 * DEG;   // more overlap: lumpier idle
cfg.exhaust_lobe_center = 108.0 * DEG;
cfg.audio.convolution = 0.8;
```

## Web / React

```
cd js
npm run build      # cargo build --target wasm32-unknown-unknown, then embed the worklet
npm test
```

The build needs nothing but a stable Rust toolchain with the wasm target
(`rustup target add wasm32-unknown-unknown`). There is no `wasm-pack` or
`wasm-bindgen` step: the crate exports a flat C ABI, so the `.wasm` loads as-is —
which is what lets the `AudioWorkletProcessor` instantiate it from bytes handed
over the message port, in a scope that has no `fetch`, no module loader and not
even a `TextDecoder`.

```jsx
import { useEngineSound } from 'engine-sound/react';

function Engine() {
  const engine = useEngineSound({ preset: 'v8_crossplane' });

  return (
    <>
      <button onClick={async () => (await engine.start())?.setStarter(true)}>
        Start
      </button>
      <input
        type="range" min={0} max={1} step={0.01}
        onChange={(e) => engine.setThrottle(+e.target.value)}
      />
      <span>{Math.round(engine.telemetry.rpm)} rpm</span>
    </>
  );
}
```

Or without React:

```js
import { createEngineSound } from 'engine-sound';

const engine = await createEngineSound({ preset: 'inline4' });
engine.setStarter(true);
engine.setGear(1);
engine.setThrottle(0.3);
```

A working page is in `js/demo/index.html` — serve `js/` with any static server
and open it. It has the preset list, throttle, gears, a `.mr` drop target and
live telemetry:

```
cd js && python -m http.server 8000
# http://localhost:8000/demo/
```

See `js/README.md` for the full API.

## Defining an engine

Four routes, in increasing order of effort:

```js
createEngineSound({ preset: 'v8_crossplane' })                                  // 1
createEngineSound({ preset: 'inline4', params: { bore: 0.086, revLimit: … } })  // 2
createEngineSound({ layout: { banks, exhausts, cylinders }, firingOrder })      // 3
engine.loadMr(mrText)                                                           // 4
```

The first three are plain data, so an engine — with its car and gearbox — can be
a JSON file in a content pipeline rather than code:

```json
{
  "name": "Fiat 500 L (1968)",
  "preset": "inline2",
  "params": { "bore": 0.0674, "crankThrow": 0.035 },
  "vehicle": { "mass": 499, "finalDrive": 5.125, "tireRadius": 0.254 },
  "gears": [3.25, 2.067, 1.3, 0.872]
}
```

JSON has no comments, so any key starting with an underscore is ignored — the
shipped examples use that to explain themselves. A genuine typo is still an
error.

`.mr` earns its place when you want engines someone else has already written.

One caveat for anything realtime: every route rebuilds the engine **on the audio
thread**, and one 128-sample quantum at 44.1 kHz is 2.9 ms. A spec rebuild takes
about 0.9 ms and fits; parsing a `.mr` file takes about 3.2 ms and does not, so
it will cost a click. Build engines at a loading screen and drive them with the
control calls afterwards, which cost nothing. `js/README.md` has the numbers.

## Gears

The engine drives a car through a gearbox and a slipping clutch, so a gear
actually loads it: first revs out in a second, top gear holds it down, lifting in
gear gives engine braking, and a change drops the revs while the car keeps its
speed.

```rust
engine.set_gear(Some(0));            // 0-based in Rust, None for neutral
let kph = engine.road_speed() * 3.6;
```

```js
engine.setGear(1);                   // 1-based in JS, 0 or null for neutral
// telemetry.gear and telemetry.speed (m/s) come back with the rest
```

A loaded engine brings its own gearbox, mass, drag, tyre radius and final drive
— from a `vehicle` and `gears` block in JSON, or from the `vehicle` and
`transmission` an `.mr` file already declares — so a Fiat 500 gets four gears and
a Ferrari six. Without one, presets get a generic five-speed saloon with the
clutch sized to the engine.

## Reading `.mr` files

engine-sim describes engines in a small declarative language called Piranha.
This crate ships a reader for it, so you can load someone else's engine:

```rust
let loaded = engine_sound::mr::load(&std::fs::read_to_string("2jz.mr")?)?;
let mut engine = SoundEngine::new(loaded.config, 44_100.0);
for warning in &loaded.warnings { eprintln!("note: {warning}"); }
```

```js
await engine.loadMr(file);   // a File from an <input>, or the text
```

The demo's drop target takes these too. Files to try in `js/demo/`:
`sample-engine.mr` (a Ferrari F136 V8 from the original's assets),
`fiat-500l.mr` and `fiat-500l.json` — the `fiat500` preset written out in each
format, which a test checks still describe one engine — and
`crossplane-four.json`, a 998 cc crossplane inline four.

The engine-sim standard library — units, constants, the object model, the
actions and the part library, some 1800 lines of `.mr` — is embedded and
interpreted, not reimplemented, so `add_flow_sample` converts flow-bench figures
exactly as the original does. Only the 80 nodes the library binds to native
implementations are written in Rust.

That library is a copy of one particular engine-sim release. Files written
against a later one are handled by a small shim of this port's own
(`mr-stdlib/compat.mr`), loaded after it so a real definition always wins. It
currently supplies `run`, which newer releases use in place of the separate
`set_engine` / `set_vehicle` / `set_transmission` calls.

Of the 27 files in the original's `assets/engines`, 23 load and run. The other
four are two library files with no engine in them, and the two radials, which
`import` a sibling file this reader cannot see — it takes one file, not a
directory.

What a file asks for that this port cannot reproduce comes back as warnings
rather than failing: impulse responses name `.wav` files from an asset tree that
is not shipped, application settings are display preferences, and this port has
one cylinder head and one set of piston and rod dimensions for the whole engine.

Some of the bigger stock engines take ten to fifteen seconds of cranking before
they catch, and a few need throttle to keep running — as they do in the
original, where you hold the starter and feed it throttle.

## Impulse responses

The exhaust convolution is what makes it sound like a car rather than a
pressure trace. The built-in response is synthetic and deliberately plain;
recorded ones are much better. Any mono WAV works:

```js
await engine.loadImpulseResponse('/exhaust.wav');
```

The original project's `assets/sound-library/` is full of suitable files.

## Performance

Measured on a desktop CPU, crossplane V8, 44.1 kHz, 4096-tap impulse response:

| | |
|---|---|
| native | ~2.9× realtime |
| wasm (Node) | ~2.4× realtime |
| wasm (Chrome AudioWorklet) | ~2.3× realtime |

Cost scales with cylinder count; the convolution is nearly free because it runs
as uniformly-partitioned FFT convolution rather than the original's direct FIR.

## What changed from the original

The audio path is a direct port — the same filters in the same order with the
same coefficients, the same gas dynamics, the same combustion and flame
propagation model, and the same exhaust signal formula. Four things differ:

**The rigid-body solver is gone.** The original runs the crank, rods and pistons
through a 2-D constraint solver, because it draws them and models a whole
drivetrain. For sound, only piston position and crank speed matter, so pistons
follow exact slider-crank kinematics and the crank is a single inertia driven by
the same gas and friction forces. Cylinder pressure — the thing that actually
makes the sound — is unchanged.

**The drivetrain is a model of its own.** The original couples engine to car
through a clutch constraint in that solver. `drivetrain.rs` replaces it: the car
carries its own speed and a slipping clutch passes torque between the two. A
rigid coupling would have been less code and wrong twice over — it cannot pull
away from rest, and a gearchange moves the car instead of dropping the revs. A
`windage_coefficient` (`torque = c·ω²`) covers the speed-dependent losses the
original left to its dynamometer; external load is exposed as `set_load_torque`.

**The synthesizer pulls instead of pushing.** The original runs a rendering
thread feeding a ring buffer, with a latency controller throttling the physics to
keep it full. An `AudioWorklet` is single-threaded and pulls, so `render` steps
the simulation exactly as far as it needs to. Same per-sample maths, no threads,
no latency drift.

**Convolution is partitioned FFT.** Mathematically the same convolution, roughly
twenty times cheaper, at the cost of 128 samples of latency. This is what makes
full-length impulse responses affordable inside an audio callback.

Two smaller notes: the spark-crossing test is rewritten to work on the unwrapped
crank angle (the original's wrapped-interval comparison can drop a spark on the
single step per cycle where the angle wraps), and preset firing angles are
derived from crank geometry rather than hand-tabulated — each cylinder is
assigned the compression-TDC angle nearest its slot in the firing order, which
reproduces the original's hand-written ignition tables exactly and stays correct
for layouts they never covered. A `.mr` file that states an angle per ignition
wire is obeyed verbatim instead, since it is not guessing.

Not ported: the dynamometer, and all rendering and UI. The vehicle and
transmission are read but only their effect on the engine is modelled — there is
no car to drive, just a load and a road speed.

## Tests

```
cargo test --release      # 88 tests: gas dynamics, kinematics, valve timing,
                          # filters, firing orders, the .mr reader, and
                          # end-to-end audio
cd js && npm test         # 47 tests: the real worklet source driven under a
                          # stub worklet scope, against the real wasm
```

The Rust suite checks the things that are easy to get quietly wrong: that
`ds/dθ` matches a numerical derivative, that cylinder volume sweeps exactly the
swept volume, that the exhaust valve is shut at firing TDC and open at the end of
the power stroke, that FFT convolution matches direct convolution, that the
flatplane V8's derived ignition angles match the original's asset file, that the
flat-6's crank is a true boxer rather than a 180° V, that the shipped Fiat 500
`.mr` file still reproduces its preset, and that the output is periodic at the
firing frequency and tracks both rpm and cylinder count.

The JavaScript suite runs the real worklet source under a stub of the worklet
global scope — with `TextEncoder`, `TextDecoder`, `fetch` and `window` denied,
because an `AudioWorkletGlobalScope` has none of them and a stub that provides
them hides real bugs. It also checks that the committed `worklet-source.js` and
`.wasm` are not stale, which is easier to get wrong than it sounds.

## Licence

MIT, matching the original. `mr-stdlib/` is a verbatim copy of engine-sim's
standard library, under the same licence.
