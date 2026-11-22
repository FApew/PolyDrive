export type Preset =
  | 'single'
  | 'inline2'
  | 'v_twin'
  | 'inline3'
  | 'inline4'
  | 'flat4'
  | 'inline5'
  | 'inline6'
  | 'v6'
  | 'flat6'
  | 'v8_crossplane'
  | 'v8_flatplane'
  | 'v10'
  | 'v12'
  | 'fiat500';

export declare const PRESETS: Preset[];
export declare const PRESET_LABELS: Record<Preset, string>;

export type ConfigParam =
  | 'simulationFrequency'
  | 'fluidSimulationSteps'
  | 'crankThrow'
  | 'momentOfInertia'
  | 'frictionTorque'
  | 'tdc'
  | 'bore'
  | 'rodLength'
  | 'compressionHeight'
  | 'chamberVolume'
  | 'deckHeight'
  | 'intakeRunnerVolume'
  | 'intakeRunnerArea'
  | 'exhaustRunnerVolume'
  | 'exhaustRunnerArea'
  | 'intakeLobeCenter'
  | 'exhaustLobeCenter'
  | 'camAdvance'
  | 'revLimit'
  | 'limiterDuration'
  | 'crankcasePressure'
  | 'starterTorque'
  | 'starterSpeed'
  | 'throttleGamma'
  | 'blowbyK'
  | 'pistonDisplacement'
  | 'intakePlenumVolume'
  | 'intakePlenumArea'
  | 'intakeInputFlowK'
  | 'intakeIdleFlowK'
  | 'intakeRunnerFlowRate'
  | 'intakeRunnerLength'
  | 'intakeIdlePlatePosition'
  | 'intakeVelocityDecay'
  | 'maxBurningEfficiency'
  | 'windageCoefficient'
  | 'starterReleaseSpeed'
  | 'starterTimeout';

export type AudioParam =
  | 'volume'
  | 'convolution'
  | 'highFrequencyGain'
  | 'jitter'
  | 'jitterCutoff'
  | 'noise'
  | 'noiseCutoff'
  | 'levelerTarget'
  | 'levelerMaxGain'
  | 'levelerMinGain';

export type VehicleParam =
  | 'mass'
  | 'dragCoefficient'
  | 'frontalArea'
  | 'tireRadius'
  | 'rollingResistance'
  | 'finalDrive'
  | 'drivelineEfficiency'
  | 'maxClutchTorque'
  | 'clutchStiffness';

export declare const VEHICLE_KEYS: Record<VehicleParam, number>;
export declare const CONFIG_KEYS: Record<ConfigParam, number>;
export declare const AUDIO_KEYS: Record<AudioParam, number>;

export interface CamOptions {
  /** Duration at 50 thou lift, radians of crank rotation. */
  intakeDuration?: number;
  /** Peak lift, metres. */
  intakeLift?: number;
  exhaustDuration?: number;
  exhaustLift?: number;
  /** Lobe shape exponent; lower is more aggressive. Defaults to 0.9. */
  gamma?: number;
}

export interface ExhaustOptions {
  /** Collector length, metres. Also sets the acoustic delay. */
  length?: number;
  /** Collector cross-section, m². */
  collectorArea?: number;
  outletFlowScfm?: number;
  primaryTubeLength?: number;
  primaryFlowScfm?: number;
  velocityDecay?: number;
  audioVolume?: number;
}

export interface CylinderOptions {
  /** Index into `layout.banks`. */
  bank?: number;
  /** Rod journal angle on the crank, radians. */
  journalAngle?: number;
  /** Index into `layout.exhausts`. */
  exhaust?: number;
  soundAttenuation?: number;
  headerPrimaryLength?: number;
}

export interface LayoutOptions {
  /** Bank angles from vertical, radians. */
  banks: Array<number | { angle: number }>;
  exhausts: ExhaustOptions[];
  cylinders: CylinderOptions[];
}

/** `[valveLiftMetres, flowScfmAt28inH2O]` pairs from a flow bench. */
export type PortFlowCurve = Array<[number, number]>;

export interface PortFlowOptions {
  intake?: PortFlowCurve;
  exhaust?: PortFlowCurve;
  /** Interpolation width, metres. Defaults to the sample spacing. */
  filterRadius?: number;
}

export interface EngineOptions {
  /** Names the engine; shows up as `engineName` and on the `engine` event. */
  name?: string;
  preset?: Preset;
  params?: Partial<Record<ConfigParam, number>>;
  audio?: Partial<Record<AudioParam, number>>;
  cam?: CamOptions;
  /** Cylinder head flow curves. Without these a custom engine keeps the base
   *  preset's head, which is wrong for anything a different size. */
  portFlow?: PortFlowOptions;
  /** The car the engine drives. */
  vehicle?: Partial<Record<VehicleParam, number>>;
  /** Gear ratios, first to top. */
  gears?: number[];
  layout?: LayoutOptions;
  /** Cylinder indices in firing order. Required when `layout` is given. */
  firingOrder?: number[];
}

export interface CreateOptions extends EngineOptions {
  context?: AudioContext;
  /** Where to connect the output. `null` leaves it unconnected. */
  destination?: AudioNode | null;
  outputChannels?: number;
  wasmBinary?: ArrayBuffer;
  wasmUrl?: string | URL;
  workletUrl?: string | URL;
}

export interface Telemetry {
  rpm: number;
  /** Manifold absolute pressure, Pa. */
  manifoldPressure: number;
  levelerGain: number;
  /** True while the starter is still cranking. */
  starterEngaged: boolean;
  /** Selected gear, 1-based; 0 is neutral. */
  gear: number;
  /** Road speed, m/s. */
  speed: number;
}

export interface ImpulseResponseOptions {
  /** Exhaust system index, or -1 (default) for all of them. */
  channel?: number;
  volume?: number;
}

export declare class EngineSound extends EventTarget {
  readonly context: AudioContext;
  readonly node: AudioWorkletNode;
  readonly rpm: number;
  readonly manifoldPressure: number;
  readonly levelerGain: number;
  readonly cylinderCount: number;
  readonly channelCount: number;
  /** Swept volume in m³ (x1000 for litres). Derived from bore, stroke and
   *  cylinder count — there is no displacement input. */
  readonly displacement: number;

  setThrottle(value: number): void;
  setStarter(enabled: boolean): void;
  setIgnition(enabled: boolean): void;
  setLoadTorque(torque: number): void;
  /**
   * Forces the crank speed. Sets rather than holds — call it every block to
   * drive rpm. In gear the car is moved to match.
   */
  setRpm(value: number): void;
  /** Selects a gear, counting from 1. `0` or `null` is neutral. */
  setGear(gear: number | null): void;
  resetSpeed(): void;
  setAudioParam(name: AudioParam, value: number): void;
  setAudioParams(params: Partial<Record<AudioParam, number>>): void;
  setImpulseResponse(
    response: Float32Array | ArrayBuffer | ArrayBufferView | AudioBuffer,
    options?: ImpulseResponseOptions,
  ): void;
  loadImpulseResponse(url: string, options?: ImpulseResponseOptions): Promise<void>;
  setEngine(options: EngineOptions): void;
  /** Loads an engine from engine-sim `.mr` source. */
  loadMr(source: string | File | Blob): Promise<void>;
  /** Warnings from the last `.mr` file loaded. */
  readonly warnings: string[];
  dispose(): void;
}

export declare function createEngineSound(options?: CreateOptions): Promise<EngineSound>;

export interface UseEngineSoundOptions extends CreateOptions {
  autoStart?: boolean;
  telemetryFps?: number;
}

export interface UseEngineSoundResult {
  status: 'idle' | 'starting' | 'ready' | 'error';
  ready: boolean;
  error: Error | null;
  telemetry: Telemetry;
  start(): Promise<EngineSound | null>;
  stop(): void;
  setThrottle(value: number): void;
  setStarter(enabled: boolean): void;
  setIgnition(enabled: boolean): void;
  setLoadTorque(torque: number): void;
  setRpm(value: number): void;
  setGear(gear: number | null): void;
  resetSpeed(): void;
  setAudioParam(name: AudioParam, value: number): void;
  setAudioParams(params: Partial<Record<AudioParam, number>>): void;
  setEngine(options: EngineOptions): void;
  loadMr(source: string | File | Blob): Promise<void>;
  setImpulseResponse(
    response: Float32Array | ArrayBuffer | ArrayBufferView | AudioBuffer,
    options?: ImpulseResponseOptions,
  ): void;
  loadImpulseResponse(url: string, options?: ImpulseResponseOptions): Promise<void>;
  engineRef: { current: EngineSound | null };
}

/**
 * React hook. Import it from `engine-sound/react`:
 * `import { useEngineSound } from 'engine-sound/react'`.
 *
 * It is not exported from the package root, so projects that do not use React
 * never have to resolve it.
 */
export declare function useEngineSound(
  options?: UseEngineSoundOptions,
): UseEngineSoundResult;

export declare function buildSpec(options?: EngineOptions): unknown;
export declare function deg(value: number): number;

export declare const DEG: number;
export declare const MM: number;
export declare const CM: number;
export declare const INCH: number;
export declare const THOU: number;
export declare const CC: number;
export declare const LITRE: number;
export declare const CM2: number;
export declare const FT_LB: number;
export declare const PORTS: { intake: 0; exhaust: 1 };
/** Flow constant from a carburettor rating: SCFM at 1.5 inHg. */
export declare function kCarb(scfm: number): number;
/** Flow constant from a head flow-bench rating: SCFM at 28 inH2O. */
export declare function k28inH2O(scfm: number): number;
export declare function rpm(value: number): number;
export declare function toRpm(value: number): number;
