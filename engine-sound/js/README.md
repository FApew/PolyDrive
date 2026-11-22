# engine-sound (JavaScript)

WebAssembly build of the engine simulation, plus the `AudioWorklet` glue and a
React hook.

```
npm run build   # cargo build for wasm32 + embed the worklet source
npm test
```

## React

```jsx
import { useEngineSound } from 'engine-sound/react';

function Engine() {
  const engine = useEngineSound({ preset: 'v8_crossplane' });

  const start = async () => {
    const created = await engine.start(); // must come from a user gesture
    created?.setStarter(true);
  };

  return (
    <>
      <button onClick={start}>Start</button>
      <input type="range" min={0} max={1} step={0.01}
             onChange={(e) => engine.setThrottle(+e.target.value)} />
      <span>{Math.round(engine.telemetry.rpm)} rpm</span>
    </>
  );
}
```

`useEngineSound(options)` takes everything `createEngineSound` does, plus
`autoStart` and `telemetryFps`, and returns:

| | |
|---|---|
| `status` | `'idle' \| 'starting' \| 'ready' \| 'error'`, and `ready` |
| `error` | an `Error`, or null |
| `telemetry` | `{ rpm, manifoldPressure, levelerGain, starterEngaged, gear, speed }`, throttled to `telemetryFps` |
| `start()` / `stop()` | `start` returns the `EngineSound` |
| `setThrottle`, `setStarter`, `setIgnition`, `setLoadTorque`, `setRpm` | stable callbacks |
| `setAudioParam`, `setAudioParams`, `setEngine` | |
| `setImpulseResponse`, `loadImpulseResponse` | |
| `engineRef` | the `EngineSound`, once ready |

## Without React

```js
import { createEngineSound } from 'engine-sound';

const engine = await createEngineSound({
  preset: 'inline4',
  audio: { volume: 0.7 },
});

engine.setStarter(true);
engine.setThrottle(0.3);

engine.addEventListener('telemetry', (e) => console.log(e.detail.rpm));
```

`createEngineSound` also accepts `context`, `destination` (pass `null` to wire it
up yourself), `outputChannels`, `wasmUrl`, `wasmBinary` and `workletUrl`.

`engine.node` is a plain `AudioWorkletNode`, so route it through anything —
a gain stage, a convolver, a panner, an analyser.

## Controls

| | |
|---|---|
| `setThrottle(0..1)` | accelerator position |
| `setStarter(true)` | one call is a key turn: it drops out once the engine catches, or after `starterTimeout` (8 s) if it never does. `telemetry.starterEngaged` says whether it is still cranking. |
| `setIgnition(false)` | cuts spark — pops and bangs on the overrun |
| `setLoadTorque(Nm)` | braking torque; enough of it will stall the engine |
| `setRpm(value)` | forces crank speed. Sets rather than holds — call it every block. In gear the car moves to match |
| `setGear(n)` | selects a gear, counting from 1; `0` or `null` is neutral |
| `resetSpeed()` | puts the car back at a standstill |

## Audio parameters

`setAudioParam(name, value)`:

| name | default | |
|---|---|---|
| `volume` | 1 | output gain |
| `convolution` | 1 | impulse response wet/dry |
| `highFrequencyGain` | 0.008–0.02 | how much of the signal's derivative to mix in |
| `jitter` | 0.1–0.4 | smears cylinder events so they aren't metronomic |
| `jitterCutoff` | 10000 | Hz |
| `noise` | 1 | amplitude modulation by filtered noise (air rush) |
| `noiseCutoff` | 2000 | Hz |
| `levelerTarget` | 30000 | auto-gain setpoint, in the internal 16-bit scale |
| `levelerMaxGain` / `levelerMinGain` | 1.9 / 1e-5 | auto-gain bounds |

## Impulse responses

The built-in response is synthetic. Recorded ones sound far better:

```js
await engine.loadImpulseResponse('/exhaust.wav');       // mono or stereo WAV
engine.setImpulseResponse(float32Array);                 // at the context rate
engine.setImpulseResponse(audioBuffer);                  // decoded
engine.setImpulseResponse(bytes, { channel: 0 });        // one exhaust bank only
```

WAV bytes are decoded and resampled inside wasm — no `decodeAudioData`, so this
also works for engines created before the page has an `AudioContext`.

## Engine parameters

`params` on creation, or `setEngine({ preset, params })` later. All SI units.

```js
import { DEG, MM, CC, rpm } from 'engine-sound';

await createEngineSound({
  preset: 'inline4',
  params: {
    bore: 82 * MM,
    crankThrow: 39 * MM,          // half the stroke
    chamberVolume: 45 * CC,       // smaller: higher compression, harder edge
    revLimit: rpm(8200),
    momentOfInertia: 0.22,        // lighter flywheel: snappier response
    windageCoefficient: 0.02,     // how fast it coasts down
    intakeLobeCenter: 108 * DEG,  // more overlap: lumpier idle
    exhaustLobeCenter: 108 * DEG,
  },
  cam: {
    intakeDuration: 240 * DEG,    // at 50 thou lift
    intakeLift: 11.5 * MM,
  },
});
```

The full list is `CONFIG_KEYS`, typed as `ConfigParam`.

### Displacement is an output, not an input

There is no displacement parameter — same as the original, where swept volume is
computed from the geometry rather than declared. Set `bore` and `crankThrow`
(half the stroke) and read it back:

```js
engine.addEventListener('engine', (e) => {
  console.log((e.detail.displacement * 1000).toFixed(2), 'L');
});
```

For a target capacity, pick a bore/stroke pair that reaches it:
`displacement = pi (bore/2)^2 * stroke * cylinders`. Bore and stroke are not
interchangeable for sound — a long-stroke engine has lower mean piston speed and
a different exhaust pulse shape at the same capacity.

`params.pistonDisplacement` is a different thing entirely: the volume of the
piston crown (positive for a dome, negative for a dish), which trims the
combustion chamber and so the compression ratio.

## Custom layouts

Describe the crank yourself. Journal angles and firing order have to agree —
a cylinder can only fire at one of the two crank angles where its piston reaches
TDC — and you'll get an error at build time if they don't.

```js
import { deg } from 'engine-sound';

await createEngineSound({
  layout: {
    banks: [deg(30), deg(-30)],            // from vertical
    exhausts: [
      { length: 2.2, primaryFlowScfm: 400, audioVolume: 0.22 },
      { length: 2.4, primaryFlowScfm: 400, audioVolume: 0.2 },
    ],
    cylinders: [
      { bank: 0, journalAngle: deg(0),   exhaust: 0, headerPrimaryLength: 0.02 },
      { bank: 0, journalAngle: deg(120), exhaust: 0, headerPrimaryLength: 0.04 },
      { bank: 0, journalAngle: deg(240), exhaust: 0, headerPrimaryLength: 0.01 },
      { bank: 1, journalAngle: deg(300), exhaust: 1, headerPrimaryLength: 0.03 },
      { bank: 1, journalAngle: deg(60),  exhaust: 1, headerPrimaryLength: 0.05 },
      { bank: 1, journalAngle: deg(180), exhaust: 1, headerPrimaryLength: 0.02 },
    ],
  },
  firingOrder: [0, 4, 2, 3, 1, 5],
});
```

Two exhaust systems means two independent gas simulations and two convolutions,
which is what gives a V engine its bank-to-bank beat. `soundAttenuation` and
`headerPrimaryLength` vary per cylinder on real engines and are a large part of
why one doesn't sound like a metronome.

## Cylinder head flow

A custom layout keeps its base preset's head, which is wrong the moment your
engine is a different size. Give it its own flow curves — the numbers a flow
bench prints, SCFM at 28 inH2O against valve lift:

```js
import { THOU } from 'engine-sound';

portFlow: {
  intake:  [[0, 0], [50 * THOU, 18], [150 * THOU, 42], [250 * THOU, 52]],
  exhaust: [[0, 0], [50 * THOU, 13], [150 * THOU, 31], [250 * THOU, 39]],
}
```

This and the carburettor constant (`intakeInputFlowK: kCarb(scfm)`) are what
decide where the engine runs out of breath. A small engine given a big preset's
head will rev to its limiter instead of trailing off, and sound wrong doing it.

`kCarb` and `k28inH2O` are the same conversions the Rust side uses, computed in
JS so a spec can be written before the wasm loads. A test pins them to the wasm
implementations.

## A worked example

The 1968 Fiat 500 L ships as a preset:

```js
const engine = await createEngineSound({ preset: 'fiat500' });
```

499.5 cc, 67.4 x 70 mm, 7.1:1, a 360° crank and one 26 mm Weber, which is why
it idles near 800 and runs out of breath at about 5200 rpm rather than reaching
its limiter.

`examples/fiat500.js` builds the same engine from scratch — custom layout, port
flow curves, carburettor constant — as the worked example of a fully custom
engine. A test checks the two still agree.

## Bundlers

The wasm is loaded with `new URL('./engine_sound.wasm', import.meta.url)`, which
Vite, webpack 5, Parcel and Rollup all understand. If your setup doesn't, pass
`wasmUrl` or `wasmBinary`.

The worklet registers from a Blob URL built from an embedded copy of
`src/worklet.js`, so nothing needs to be copied into your public directory. To
serve it yourself instead, pass `workletUrl`.

## Notes

- Audio cannot start without a user gesture. Call `start()` from a click.
- The simulation runs entirely on the audio thread; the main thread only posts
  control changes and receives telemetry at ~20 Hz.
- Rendering costs roughly 40 % of realtime for a V8. Twelve cylinders cost more;
  check on your target hardware before shipping several at once.

## Loading `.mr` files

```js
// A File from an <input type="file">, or the source text.
await engine.loadMr(file);

engine.addEventListener('engine', (e) => {
  console.log(e.detail.cylinders, 'cylinders');
  for (const w of e.detail.warnings) console.warn(w);
});
engine.addEventListener('error', (e) => console.error(e.detail));
```

The standard library is built into the wasm, so this needs only the engine file
itself — the same file the original loads. A file it cannot read raises `error`
with the reason and the line; anything it can read but not reproduce exactly
comes back as `warnings` on the `engine` event.

Multi-file engines are not supported: a file that `import`s a sibling of its own
gets an "is not a known node type" error, because the reader is given one file
rather than a directory.

Files written for a newer engine-sim than the embedded library are handled where
possible — `run(engine:, vehicle:, transmission:)` works as well as
`set_engine`. A node the reader has never heard of raises an `error` naming it,
and the engine that was already playing keeps playing.

## Gears

The engine drives a car through a gearbox and a slipping clutch, so a gear
actually loads it: first revs out in a second, top gear holds it down, and
lifting in gear gives engine braking.

```js
engine.setGear(1);          // counting from 1; 0 or null is neutral
engine.setThrottle(1);
// telemetry.speed is road speed in m/s, telemetry.gear is 1-based
```

`engine.gearCount` says how many gears the car has — a loaded `.mr` file brings
its own, so a Fiat 500 gets four and a Ferrari six, along with that car's mass,
drag, tyre radius and final drive. Without a file, presets get a generic
five-speed saloon, with the clutch sized to the engine.

The clutch is a slipping coupling rather than a rigid one. That is what lets the
car pull away from rest and makes a gearchange drop the revs instead of moving
the car; the price is one extra state variable and a shift that takes a moment
to settle, as a real one does.

## Defining an engine from a game

Four routes, in increasing order of effort:

```js
// 1. A preset.
createEngineSound({ preset: 'v8_crossplane' })

// 2. A preset with the numbers changed. Keeps its bank and crank layout.
createEngineSound({ preset: 'inline4', params: { bore: 0.086, revLimit: rpm(7600) } })

// 3. Your own layout: banks, journal angles, exhaust routing, firing order.
createEngineSound({ layout: { banks, exhausts, cylinders }, firingOrder })

// 4. An engine-sim file.
engine.loadMr(await fetch('/engines/2jz.mr').then((r) => r.text()))
```

For a game, **1 to 3 are the ones to reach for**, because they are plain data —
no code, no parser. An engine can be a JSON file in your content pipeline:

```json
{
  "preset": "inline4",
  "params": { "bore": 0.086, "crankThrow": 0.043, "revLimit": 733 },
  "cam": { "intakeDuration": 4.19, "intakeLift": 0.0115 },
  "audio": { "volume": 0.8, "jitter": 0.2 }
}
```

```js
const engine = await createEngineSound(await fetch('/engines/gt.json').then((r) => r.json()));
```

Two worked examples sit beside the demo, and can be dropped straight into it:

| | |
|---|---|
| `demo/fiat-500l.json` | The `fiat500` preset written as data, with its four-speed gearbox and the car around it. A test checks it, the `.mr` file and the preset are the same engine. |
| `demo/crossplane-four.json` | A 998 cc crossplane inline four — journal angles `0/90/270/180` and a `1-2-4-3` order give the 270-180-90-180 firing pattern, without it being written down anywhere. |

JSON has no comments, so **any key starting with an underscore is ignored**,
everywhere. Both files use that to explain themselves. A genuine typo is still
an error rather than being silently dropped.

The car goes in the same file:

```json
{
  "vehicle": { "mass": 499, "finalDrive": 5.125, "tireRadius": 0.254 },
  "gears": [3.25, 2.067, 1.3, 0.872]
}
```

Tests pin the JSON round-trip for a tuned preset, a full custom layout, and both
shipped example files, so engines can safely live in content rather than code.

`.mr` earns its place when you want engines other people have already written —
the original's asset set, or something from its community — rather than as a
format to author in yourself.

### Build engines at load time, not mid-race

Everything above rebuilds the engine **on the audio thread**, and one audio
quantum at 44.1 kHz is 2.9 ms. Measured on a desktop CPU:

| | |
|---|---|
| build from a preset or spec | ~0.9 ms |
| parse a `.mr` file and build | ~3.2 ms |
| `setThrottle` / `setGear` / `setRpm` | free — a message, no work |
| render one 128-sample block | ~1.0 ms |

So a spec rebuild fits inside a quantum alongside rendering, with little room to
spare; a `.mr` load does not, and will cost you a click. Build during a loading
screen, a menu, or a pit stop — anywhere a single dropped buffer does not
matter — and thereafter drive it with the control calls, which cost nothing.

If you need to swap engines while sound is playing and cannot tolerate the
click, fade the output down over a few blocks, swap, and fade back up.
