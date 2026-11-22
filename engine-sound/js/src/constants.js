/**
 * Names for the numeric ids in the WebAssembly ABI (`src/ffi.rs`).
 *
 * These live on the main thread only. Everything posted to the worklet carries
 * already-resolved numeric keys, so the audio thread never does a lookup.
 */

/**
 * Built-in engines, in ABI id order.
 *
 * Order is significant: the index is the preset id passed to wasm. It mirrors
 * `ALL_PRESETS` in `src/config.rs`, and `test/worklet.test.mjs` checks the two
 * have not drifted apart.
 */
export const PRESETS = [
  'single',
  'inline2',
  'v_twin',
  'inline3',
  'inline4',
  'flat4',
  'inline5',
  'inline6',
  'v6',
  'flat6',
  'v8_crossplane',
  'v8_flatplane',
  'v10',
  'v12',
  // Specific engines, after the generic layouts.
  'fiat500',
];

export const PRESET_LABELS = {
  single: 'Single cylinder',
  inline2: '270° parallel twin',
  v_twin: '45° V-twin',
  inline3: 'Inline 3',
  inline4: 'Inline 4',
  flat4: 'Flat 4',
  inline5: 'Inline 5',
  inline6: 'Inline 6',
  v6: '60° V6',
  flat6: 'Flat 6',
  v8_crossplane: '90° V8 (crossplane)',
  v8_flatplane: '90° V8 (flatplane)',
  v10: '72° V10',
  v12: '60° V12',
  fiat500: '360° parallel twin',
};

/** Engine configuration keys. All values are SI unless noted. */
export const CONFIG_KEYS = {
  simulationFrequency: 0,
  fluidSimulationSteps: 1,
  crankThrow: 2,
  momentOfInertia: 3,
  frictionTorque: 4,
  tdc: 5,
  bore: 6,
  rodLength: 7,
  compressionHeight: 8,
  chamberVolume: 9,
  deckHeight: 10,
  intakeRunnerVolume: 11,
  intakeRunnerArea: 12,
  exhaustRunnerVolume: 13,
  exhaustRunnerArea: 14,
  intakeLobeCenter: 15,
  exhaustLobeCenter: 16,
  camAdvance: 17,
  revLimit: 18,
  limiterDuration: 19,
  crankcasePressure: 20,
  starterTorque: 21,
  starterSpeed: 22,
  throttleGamma: 23,
  blowbyK: 24,
  pistonDisplacement: 25,
  intakePlenumVolume: 26,
  intakePlenumArea: 27,
  intakeInputFlowK: 28,
  intakeIdleFlowK: 29,
  intakeRunnerFlowRate: 30,
  intakeRunnerLength: 31,
  intakeIdlePlatePosition: 32,
  intakeVelocityDecay: 33,
  maxBurningEfficiency: 34,
  windageCoefficient: 35,
  starterReleaseSpeed: 36,
  /** Seconds one starter attempt cranks before giving up. */
  starterTimeout: 37,
};

/** The car the engine drives. All SI. */
export const VEHICLE_KEYS = {
  /** Kerb mass plus driver, kg. */
  mass: 0,
  dragCoefficient: 1,
  /** Frontal area, m². */
  frontalArea: 2,
  tireRadius: 3,
  /** Constant rolling drag, N. */
  rollingResistance: 4,
  finalDrive: 5,
  /** Fraction of drive reaching the wheels, 0..1. */
  drivelineEfficiency: 6,
  /** Most torque the clutch can pass, N·m. */
  maxClutchTorque: 7,
  /** Torque passed per rad/s of clutch slip. */
  clutchStiffness: 8,
};

/** Audio chain parameters. */
export const AUDIO_KEYS = {
  /** Output gain. */
  volume: 0,
  /** Impulse response wet/dry mix, 0..1. */
  convolution: 1,
  /** High frequency gain: how much of the signal's derivative to mix in. */
  highFrequencyGain: 2,
  /** Jitter depth, 0..1. Smears cylinder events so they are not metronomic. */
  jitter: 3,
  jitterCutoff: 4,
  /** Amplitude modulation by filtered noise, 0..1. */
  noise: 5,
  noiseCutoff: 6,
  levelerTarget: 7,
  levelerMaxGain: 8,
  levelerMinGain: 9,
};

export const DEG = Math.PI / 180;
export const MM = 0.001;
export const CM = 0.01;
export const INCH = 0.0254;
export const THOU = INCH / 1000;
export const CC = 1e-6;
export const LITRE = 1e-3;
export const CM2 = 1e-4;
export const FT_LB = 1.3558179483314004;

/** Which port flow curve a `portFlow` entry targets. */
export const PORTS = { intake: 0, exhaust: 1 };

const R = 8.31446261815324;
const ATM = 101325;
const INHG = 3386.3886666666713;
const INH2O = INHG * 0.0734824;
const SCFM = (0.002641 * 453.59237) / 60;
const HCR = 1.4; // diatomic, five degrees of freedom

/**
 * Flow constant for a component that passes `targetFlowRate` mol/s at the given
 * pressure drop. Mirrors `flow_constant` in `src/gas.rs`; kept in JS so a spec
 * can be written in the units a flow bench or a carburettor is rated in,
 * without waiting for the wasm to load.
 */
function flowConstant(targetFlowRate, pressure, pressureDrop, temperature) {
  const p0 = pressure;
  const pT = pressure - pressureDrop;
  const limit = (2 / (HCR + 1)) ** (HCR / (HCR - 1));
  const ratio = pT / p0;

  let rate;
  if (ratio <= limit) {
    rate = Math.sqrt(HCR) * (2 / (HCR + 1)) ** ((HCR + 1) / (2 * (HCR - 1)));
  } else {
    rate = (2 * HCR) / (HCR - 1);
    rate *= 1 - ratio ** ((HCR - 1) / HCR);
    rate = Math.sqrt(rate);
    rate *= ratio ** (1 / HCR);
  }

  rate *= p0 / Math.sqrt(R * temperature);
  return targetFlowRate / rate;
}

/** Flow constant from a carburettor rating: SCFM at 1.5 inHg. */
export const kCarb = (scfm) => flowConstant(scfm * SCFM, ATM, 1.5 * INHG, 298.15);

/** Flow constant from a head flow-bench rating: SCFM at 28 inH2O. */
export const k28inH2O = (scfm) => flowConstant(scfm * SCFM, ATM, 28 * INH2O, 298.15);

/** rad/s from RPM. */
export const rpm = (value) => value * 0.104719755;
/** RPM from rad/s. */
export const toRpm = (value) => value / 0.104719755;
