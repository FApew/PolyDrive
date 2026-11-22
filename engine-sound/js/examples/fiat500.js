/**
 * 1968 Fiat 500 L — engine 110F.000.
 *
 * 499.5 cc air-cooled OHV parallel twin, 67.4 x 70 mm, 7.1:1, 18 hp at
 * 4600 rpm, one Weber 26 IMB for both cylinders.
 *
 * The thing that makes it sound like a 500 rather than like any other twin is
 * the **360° crank**: both pistons rise together and fire one full revolution
 * apart, so the beat is perfectly even. (A modern parallel twin uses 270° pins
 * and sounds lopsided; see the `inline2` preset.) After that it is all
 * restriction — tiny ports, a single small choke, and no water jacket to muffle
 * anything.
 *
 * **This engine ships as the `fiat500` preset** — for normal use just say
 * `createEngineSound({ preset: 'fiat500' })`. What follows is the same engine
 * built from scratch, kept as the worked example of a fully custom engine:
 * custom crank layout, cylinder head flow curves and carburettor constant. A
 * test checks it still reproduces the preset.
 *
 * ```js
 * import { createEngineSound } from 'engine-sound';
 * import { FIAT_500_L } from 'engine-sound/examples/fiat500.js';
 *
 * const engine = await createEngineSound(FIAT_500_L);
 * engine.setStarter(true);
 * ```
 */

import { CC, CM, CM2, DEG, LITRE, MM, THOU, kCarb, rpm } from 'engine-sound';

const BORE = 67.4 * MM;
const STROKE = 70 * MM;
const COMPRESSION_RATIO = 7.1;

const sweptPerCylinder = Math.PI * (BORE / 2) ** 2 * STROKE; // 249.75 cc
const chamberVolume = sweptPerCylinder / (COMPRESSION_RATIO - 1); // 40.9 cc

export const FIAT_500_L = {
  // Any preset works as the starting point; everything that matters is
  // replaced below. The twin is the closest fit.
  preset: 'inline2',

  layout: {
    // One bank. The real engine is canted over in the tail, which changes
    // nothing acoustically.
    banks: [0],

    // Both cylinders into one small silencer.
    exhausts: [
      {
        length: 1.4,
        collectorArea: 9 * CM2,
        outletFlowScfm: 60,
        primaryTubeLength: 0.35,
        primaryFlowScfm: 30,
        velocityDecay: 0.5,
        audioVolume: 0.22,
      },
    ],

    // 360° crank: both journals at the same angle, so the pistons move
    // together. Combined with the firing order below this puts the two power
    // strokes exactly one revolution apart.
    cylinders: [
      { bank: 0, journalAngle: 0, exhaust: 0, headerPrimaryLength: 12 * CM, soundAttenuation: 1.0 },
      { bank: 0, journalAngle: 0, exhaust: 0, headerPrimaryLength: 20 * CM, soundAttenuation: 0.95 },
    ],
  },
  firingOrder: [0, 1],

  // Small two-valve OHV head: a ~28 mm inlet valve, and an exhaust side that
  // flows about three quarters of the inlet. SCFM at 28 inH2O against lift.
  portFlow: {
    intake: [
      [0, 0],
      [50 * THOU, 18],
      [100 * THOU, 32],
      [150 * THOU, 42],
      [200 * THOU, 48],
      [250 * THOU, 52],
      [300 * THOU, 54],
    ],
    exhaust: [
      [0, 0],
      [50 * THOU, 13],
      [100 * THOU, 23],
      [150 * THOU, 31],
      [200 * THOU, 36],
      [250 * THOU, 39],
      [300 * THOU, 41],
    ],
  },

  // Mild pushrod cam: short duration, modest lift.
  cam: {
    intakeDuration: 200 * DEG,
    intakeLift: 260 * THOU,
    gamma: 0.9,
  },

  params: {
    bore: BORE,
    crankThrow: STROKE / 2,
    rodLength: 118 * MM,
    compressionHeight: 30 * MM,
    deckHeight: STROKE / 2 + 118 * MM + 30 * MM,
    chamberVolume,

    intakeLobeCenter: 112 * DEG,
    exhaustLobeCenter: 112 * DEG,
    intakeRunnerVolume: 55 * CC,
    intakeRunnerArea: (26 * MM) ** 2,
    exhaustRunnerVolume: 30 * CC,
    exhaustRunnerArea: (24 * MM) ** 2,

    // One 26 mm Weber feeding both cylinders. At 4600 rpm the engine wants
    // about 40 CFM at 100% VE, and this is what stops it getting there — the
    // reason it makes 18 hp and runs out of breath below the limiter.
    intakePlenumVolume: 0.55 * LITRE,
    intakePlenumArea: 5.3 * CM2,
    intakeInputFlowK: kCarb(42),
    intakeRunnerFlowRate: kCarb(24),
    intakeRunnerLength: 18 * CM,
    // Wound further open than a car engine's idle stop: a 500 idles near 800.
    intakeIdlePlatePosition: 0.986,

    // Small, but the cast flywheel also drives the cooling fan.
    momentOfInertia: 0.085,
    frictionTorque: 4.07, // 3 lb-ft
    windageCoefficient: 0.03 * (sweptPerCylinder * 2),

    revLimit: rpm(5400),
    starterTorque: 81.3, // 60 lb-ft
    starterSpeed: rpm(280),
  },

  audio: {
    // Air-cooled and thin-panelled: plenty of mechanical edge, little damping.
    highFrequencyGain: 0.022,
    jitter: 0.32,
    noise: 1.0,
  },
};

export default FIAT_500_L;
