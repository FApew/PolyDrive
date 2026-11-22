/**
 * Main-thread controller: owns the AudioWorkletNode and forwards control
 * changes to the simulation running on the audio thread.
 */

import { AUDIO_KEYS } from './constants.js';
import { buildSpec } from './spec.js';
import { WORKLET_SOURCE } from './worklet-source.js';

/**
 * Text conversion lives here, not in the worklet: an AudioWorkletGlobalScope
 * has neither `TextDecoder` nor `TextEncoder`, so only bytes cross the port.
 */
const decoder = new TextDecoder();
const encoder = new TextEncoder();

function decodeWarnings(bytes) {
  if (!bytes || !bytes.length) return [];
  try {
    const parsed = JSON.parse(decoder.decode(bytes));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Registered worklet modules, keyed by AudioContext. */
const registered = new WeakMap();

function defaultWasmUrl() {
  return new URL('./engine_sound.wasm', import.meta.url);
}

async function loadWasm({ wasmBinary, wasmUrl }) {
  if (wasmBinary) {
    return wasmBinary instanceof ArrayBuffer ? wasmBinary : wasmBinary.buffer;
  }
  const url = wasmUrl || defaultWasmUrl();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not fetch engine-sound wasm from ${url} (${response.status})`);
  }
  return response.arrayBuffer();
}

async function registerWorklet(context, workletUrl) {
  let pending = registered.get(context);
  if (!pending) {
    const url =
      workletUrl ||
      URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    pending = context.audioWorklet.addModule(url);
    registered.set(context, pending);
  }
  return pending;
}

export class EngineSound extends EventTarget {
  /**
   * @param {AudioContext} context
   * @param {AudioWorkletNode} node
   */
  constructor(context, node) {
    super();
    this.context = context;
    this.node = node;
    this.rpm = 0;
    this.manifoldPressure = 101325;
    this.levelerGain = 1;
    this.starterEngaged = false;
    this.cylinderCount = 0;
    this.channelCount = 0;
    /** Swept volume in m³; multiply by 1000 for litres. Read-only: it is
     *  derived from bore, stroke and cylinder count, not set. */
    this.displacement = 0;
    /** Warnings from the last `.mr` file loaded. */
    this.warnings = [];
    this.disposed = false;

    node.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'telemetry') {
        this.rpm = msg.rpm;
        this.manifoldPressure = msg.manifoldPressure;
        this.levelerGain = msg.levelerGain;
        this.starterEngaged = msg.starterEngaged;
        // Gears are 1-based to callers; -1 from the ABI means neutral.
        msg.gear = msg.gear < 0 ? 0 : msg.gear + 1;
        this.gear = msg.gear;
        this.speed = msg.speed;
        this.dispatchEvent(new CustomEvent('telemetry', { detail: msg }));
      } else if (msg.type === 'engine') {
        msg.name = msg.nameBytes ? decoder.decode(msg.nameBytes) : '';
        msg.warnings = decodeWarnings(msg.warningsJson);
        this.cylinderCount = msg.cylinders;
        this.channelCount = msg.channels;
        this.displacement = msg.displacement;
        this.warnings = msg.warnings || [];
        this.dispatchEvent(new CustomEvent('engine', { detail: msg }));
      } else if (msg.type === 'error') {
        const message = msg.messageBytes
          ? decoder.decode(msg.messageBytes) || 'could not read the file'
          : msg.message;
        this.dispatchEvent(new CustomEvent('error', { detail: message }));
      }
    };
  }

  post(message, transfer) {
    if (this.disposed) return;
    this.node.port.postMessage(message, transfer || []);
  }

  /** Accelerator position, 0..1. */
  setThrottle(value) {
    this.post({ type: 'throttle', value: clamp01(value) });
  }

  /**
   * Engages the starter motor. One call is a key turn: it disengages by itself
   * once the engine is running under its own power, or after
   * `starterTimeout` seconds if it never catches. Watch `starterEngaged` (also
   * on every telemetry event) to show cranking state.
   */
  setStarter(enabled) {
    this.post({ type: 'starter', value: !!enabled });
  }

  /**
   * Selects a gear, counting from 1. `0` or `null` is neutral.
   *
   * The car is coupled through a slipping clutch, so it can pull away from
   * rest and a gearchange drops the revs rather than moving the car.
   */
  setGear(gear) {
    const index = gear === null || gear === undefined ? -1 : Math.round(gear) - 1;
    this.post({ type: 'gear', value: index < 0 ? -1 : index });
  }

  /** Puts the car back at a standstill without touching the engine. */
  resetSpeed() {
    this.post({ type: 'resetSpeed' });
  }

  /** Cuts or restores the spark. */
  setIgnition(enabled) {
    this.post({ type: 'ignition', value: !!enabled });
  }

  /** External braking torque in N·m, always opposing rotation. */
  setLoadTorque(torque) {
    this.post({ type: 'load', value: Number(torque) || 0 });
  }

  /**
   * Forces the crank speed, overriding whatever combustion was doing. Use when
   * you want to drive RPM directly from a game or a UI slider.
   *
   * This sets the speed, it does not hold it — combustion takes over from the
   * next block, so keep calling it. In gear the car is moved to match, so the
   * clutch has nothing to slam shut; select neutral to rev against nothing.
   */
  setRpm(value) {
    this.post({ type: 'rpm', value: Math.max(0, Number(value) || 0) });
  }

  /** @param {keyof typeof AUDIO_KEYS} name */
  setAudioParam(name, value) {
    const key = AUDIO_KEYS[name];
    if (key === undefined) throw new Error(`unknown audio parameter "${name}"`);
    this.post({ type: 'audioParam', key, value: Number(value) });
  }

  setAudioParams(params) {
    for (const [name, value] of Object.entries(params || {})) {
      this.setAudioParam(name, value);
    }
  }

  /**
   * Replaces the exhaust impulse response.
   *
   * @param {Float32Array|ArrayBuffer|AudioBuffer} response float samples at the
   *   context sample rate, raw WAV bytes, or a decoded AudioBuffer
   * @param {object} [options] `{ channel, volume }`; channel defaults to all
   */
  setImpulseResponse(response, options = {}) {
    const { channel = -1, volume = 1 } = options;

    if (typeof AudioBuffer !== 'undefined' && response instanceof AudioBuffer) {
      const data = Float32Array.from(response.getChannelData(0));
      this.post({ type: 'impulseResponse', channel, volume, data }, [data.buffer]);
      return;
    }

    if (response instanceof Float32Array) {
      const data = Float32Array.from(response);
      this.post({ type: 'impulseResponse', channel, volume, data }, [data.buffer]);
      return;
    }

    if (response instanceof ArrayBuffer || ArrayBuffer.isView(response)) {
      const bytes = response instanceof ArrayBuffer ? response.slice(0) : response.buffer.slice(0);
      this.post({ type: 'impulseResponseWav', channel, volume, bytes }, [bytes]);
      return;
    }

    throw new TypeError('impulse response must be a Float32Array, AudioBuffer or WAV bytes');
  }

  /** Fetches a WAV file and installs it as the impulse response. */
  async loadImpulseResponse(url, options) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`could not fetch impulse response from ${url} (${response.status})`);
    }
    this.setImpulseResponse(await response.arrayBuffer(), options);
  }

  /** Swaps in a different engine without recreating the audio graph. */
  setEngine(options) {
    this.post({ type: 'engine', spec: buildSpec(options) });
  }

  /**
   * Loads an engine from engine-sim `.mr` source.
   *
   * The standard library is built in, so this only needs the engine file
   * itself. Anything the file asks for that this port cannot reproduce comes
   * back as `warnings` on the `engine` event; a file it cannot read at all
   * raises `error`.
   *
   * @param {string|File|Blob} source the text, or a file from an `<input>`
   */
  async loadMr(source) {
    const text = typeof source === 'string' ? source : await source.text();
    const bytes = encoder.encode(text);
    this.post({ type: 'mr', source: bytes }, [bytes.buffer]);
  }

  /** Stops the simulation and disconnects. Safe to call twice. */
  dispose() {
    if (this.disposed) return;
    this.post({ type: 'dispose' });
    this.disposed = true;
    try {
      this.node.disconnect();
    } catch {
      /* already disconnected */
    }
    this.node.port.onmessage = null;
  }
}

function clamp01(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Creates an engine and connects it to the audio graph.
 *
 * @param {object} [options]
 * @param {AudioContext} [options.context] existing context; one is created if absent
 * @param {AudioNode|null} [options.destination] defaults to `context.destination`
 * @param {string} [options.preset] see PRESETS
 * @param {object} [options.params] engine parameter overrides
 * @param {object} [options.audio] audio chain overrides
 * @param {object} [options.layout] custom bank/cylinder/exhaust layout
 * @param {number[]} [options.firingOrder] required with a custom layout
 * @param {ArrayBuffer} [options.wasmBinary] pre-fetched wasm
 * @param {string|URL} [options.wasmUrl] where to fetch the wasm from
 * @param {string|URL} [options.workletUrl] serve the worklet yourself instead
 *   of using the built-in Blob URL
 * @returns {Promise<EngineSound>}
 */
export async function createEngineSound(options = {}) {
  const context = options.context || new AudioContext();
  const spec = buildSpec(options);

  const [wasm] = await Promise.all([
    loadWasm(options),
    registerWorklet(context, options.workletUrl),
  ]);

  const node = new AudioWorkletNode(context, 'engine-sound', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [options.outputChannels || 2],
    processorOptions: { wasm, spec },
  });

  const engine = new EngineSound(context, node);

  const destination =
    options.destination === undefined ? context.destination : options.destination;
  if (destination) node.connect(destination);

  return engine;
}
