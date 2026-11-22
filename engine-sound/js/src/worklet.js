/**
 * AudioWorkletProcessor that runs the engine simulation on the audio thread.
 *
 * This file is the source of truth for the worklet; `worklet-source.js` is a
 * generated string copy of it so the package can register the processor from a
 * Blob URL with no build configuration. Run `npm run build:worklet` after
 * editing.
 *
 * The processor talks to WebAssembly through a flat C ABI, so there is no
 * wasm-bindgen glue and no module loader — which matters, because an
 * AudioWorklet scope has neither `fetch` nor dynamic `import`. The wasm bytes
 * arrive through `processorOptions`.
 *
 * All parameter keys crossing the port are already numeric: the main thread
 * resolves names to ABI ids so this side needs no lookup tables.
 */

/**
 * Copies UTF-8 bytes out of the wasm heap.
 *
 * An AudioWorkletGlobalScope has no `TextDecoder` or `TextEncoder` — it is
 * neither a Window nor a WorkerGlobalScope — so all text conversion happens on
 * the main thread and only bytes cross the port.
 */
function readBytes(w, ptr, len) {
  return len ? new Uint8Array(w.memory.buffer, ptr, len).slice() : new Uint8Array(0);
}

/** Everything a caller needs to describe the engine that was just built. */
function describe(w, engine) {
  return {
    nameBytes: readBytes(w, w.es_name_ptr(engine), w.es_name_len(engine)),
    cylinders: w.es_cylinder_count(engine),
    banks: w.es_bank_count(engine),
    channels: w.es_channel_count(engine),
    displacement: w.es_displacement(engine),
    compressionRatio: w.es_compression_ratio(engine),
    revLimit: w.es_rev_limit(engine),
    gears: w.es_gear_count(engine),
  };
}

class EngineSoundProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const opts = options.processorOptions || {};

    this.wasm = null;
    this.engine = 0;
    this.outputPtr = 0;
    this.outputLength = 0;
    this.view = null;
    this.telemetryCountdown = 0;
    this.telemetryInterval = Math.max(1, Math.round(sampleRate / 128 / 20)); // ~20 Hz
    this.failed = false;

    this.port.onmessage = (event) => this.handleMessage(event.data);

    if (opts.wasm) {
      this.instantiate(opts.wasm);
      if (opts.spec) this.buildEngine(opts.spec);
    }
  }

  instantiate(bytes) {
    try {
      const module = new WebAssembly.Module(bytes);
      const instance = new WebAssembly.Instance(module, {});
      this.wasm = instance.exports;
      this.port.postMessage({ type: 'ready', abi: this.wasm.es_abi_version() });
    } catch (error) {
      this.failed = true;
      this.port.postMessage({ type: 'error', message: String(error) });
    }
  }

  /** Builds an engine from `.mr` source text. */
  buildEngineFromMr(source) {
    try {
      this.buildEngineFromMrInner(source);
    } catch (error) {
      this.port.postMessage({ type: 'error', message: String(error) });
    }
  }

  buildEngineFromMrInner(source) {
    const w = this.wasm;
    if (!w) return;

    const bytes = source;
    const ptr = w.es_alloc(bytes.length);
    new Uint8Array(w.memory.buffer, ptr, bytes.length).set(bytes);
    const result = w.es_mr_load(ptr, bytes.length);
    w.es_dealloc(ptr, bytes.length);

    const messageBytes = readBytes(
      w,
      w.es_mr_message_ptr(result),
      w.es_mr_message_len(result),
    );

    if (!w.es_mr_ok(result)) {
      w.es_mr_free(result);
      // The main thread decodes it; see readBytes.
      this.port.postMessage({ type: 'error', messageBytes });
      return;
    }

    const cfg = w.es_mr_take_config(result);
    w.es_mr_free(result);

    const engine = w.es_new(cfg, sampleRate);
    if (!engine) {
      this.port.postMessage({ type: 'error', message: 'the file described an incomplete engine' });
      return;
    }

    if (this.engine) w.es_destroy(this.engine);
    this.engine = engine;
    this.view = null;

    this.port.postMessage({
      type: 'engine',
      source: 'mr',
      ...describe(w, engine),
      warningsJson: messageBytes,
    });
  }

  /**
   * Rebuilds the engine from a spec produced by the main thread.
   *
   * Anything thrown here would otherwise kill the processor silently — no
   * audio, no message, nothing in the console — so it is reported instead.
   */
  buildEngine(spec) {
    try {
      this.buildEngineFromSpec(spec);
    } catch (error) {
      this.port.postMessage({ type: 'error', message: String(error) });
    }
  }

  buildEngineFromSpec(spec) {
    const w = this.wasm;
    if (!w) return;

    const cfg = w.es_config_new(spec.presetId >>> 0);
    if (!cfg) {
      this.port.postMessage({ type: 'error', message: 'unknown preset' });
      return;
    }

    if (spec.layout) {
      w.es_config_clear_layout(cfg);
      for (const angle of spec.layout.banks) {
        w.es_config_add_bank(cfg, angle);
      }
      for (const e of spec.layout.exhausts) {
        w.es_config_add_exhaust(
          cfg,
          e[0], // length, m
          e[1], // collector cross-section area, m^2
          w.es_k_carb(e[2]), // outlet flow, SCFM
          e[3], // primary tube length, m
          w.es_k_carb(e[4]), // primary flow, SCFM
          e[5], // velocity decay
          e[6], // audio volume
        );
      }
      for (const c of spec.layout.cylinders) {
        w.es_config_add_cylinder(cfg, c[0] >>> 0, c[1], c[2] >>> 0, c[3], c[4]);
      }
    }

    for (const [key, value] of spec.vehicle || []) {
      w.es_config_set_vehicle(cfg, key >>> 0, value);
    }

    if (spec.gears && spec.gears.length) {
      const bytes = spec.gears.length * 8;
      const ptr = w.es_alloc(bytes);
      new Float64Array(w.memory.buffer, ptr, spec.gears.length).set(spec.gears);
      w.es_config_set_gears(cfg, ptr, spec.gears.length);
      w.es_dealloc(ptr, bytes);
    }

    if (spec.nameBytes && spec.nameBytes.length) {
      const ptr = w.es_alloc(spec.nameBytes.length);
      new Uint8Array(w.memory.buffer, ptr, spec.nameBytes.length).set(spec.nameBytes);
      w.es_config_set_name(cfg, ptr, spec.nameBytes.length);
      w.es_dealloc(ptr, spec.nameBytes.length);
    }

    for (const [which, lifts, flows, filterRadius] of spec.portFlow || []) {
      const bytes = lifts.length * 8;
      const liftPtr = w.es_alloc(bytes);
      const flowPtr = w.es_alloc(bytes);
      new Float64Array(w.memory.buffer, liftPtr, lifts.length).set(lifts);
      new Float64Array(w.memory.buffer, flowPtr, flows.length).set(flows);
      w.es_config_set_port_flow(cfg, which >>> 0, liftPtr, flowPtr, lifts.length, filterRadius);
      w.es_dealloc(liftPtr, bytes);
      w.es_dealloc(flowPtr, bytes);
    }

    if (spec.cam) {
      w.es_config_set_cam(cfg, spec.cam[0], spec.cam[1], spec.cam[2], spec.cam[3], spec.cam[4]);
    }

    for (const [key, value] of spec.params || []) {
      w.es_config_set(cfg, key >>> 0, value);
    }
    for (const [key, value] of spec.audio || []) {
      w.es_config_set_audio(cfg, key >>> 0, value);
    }

    // Firing order last: it reads the final journal angles and bank layout.
    if (spec.firingOrder && spec.firingOrder.length) {
      const bytes = spec.firingOrder.length * 4;
      const ptr = w.es_alloc(bytes);
      new Uint32Array(w.memory.buffer, ptr, spec.firingOrder.length).set(spec.firingOrder);
      w.es_config_set_firing_order(cfg, ptr, spec.firingOrder.length);
      w.es_dealloc(ptr, bytes);
    }

    const engine = w.es_new(cfg, sampleRate);
    if (!engine) {
      this.port.postMessage({ type: 'error', message: 'engine configuration is incomplete' });
      return;
    }

    if (this.engine) w.es_destroy(this.engine);
    this.engine = engine;
    this.view = null;

    this.port.postMessage({
      type: 'engine',
      source: 'spec',
      ...describe(w, engine),
      warningsJson: new Uint8Array(0),
    });
  }

  handleMessage(msg) {
    try {
      this.dispatch(msg);
    } catch (error) {
      this.port.postMessage({ type: 'error', message: String(error) });
    }
  }

  dispatch(msg) {
    const w = this.wasm;

    if (msg.type === 'wasm') {
      this.instantiate(msg.bytes);
      if (msg.spec) this.buildEngine(msg.spec);
      return;
    }

    if (!w) return;

    switch (msg.type) {
      case 'engine':
        this.buildEngine(msg.spec);
        return;
      case 'mr':
        this.buildEngineFromMr(msg.source);
        return;
      case 'dispose':
        if (this.engine) {
          w.es_destroy(this.engine);
          this.engine = 0;
        }
        this.disposed = true;
        return;
      default:
        break;
    }

    if (!this.engine) return;

    switch (msg.type) {
      case 'throttle':
        w.es_set_throttle(this.engine, msg.value);
        break;
      case 'starter':
        w.es_set_starter(this.engine, msg.value ? 1 : 0);
        break;
      case 'ignition':
        w.es_set_ignition(this.engine, msg.value ? 1 : 0);
        break;
      case 'load':
        w.es_set_load_torque(this.engine, msg.value);
        break;
      case 'rpm':
        w.es_set_rpm(this.engine, msg.value);
        break;
      case 'gear':
        w.es_set_gear(this.engine, msg.value);
        break;
      case 'resetSpeed':
        w.es_reset_road_speed(this.engine);
        break;
      case 'audioParam':
        w.es_set_audio_param(this.engine, msg.key >>> 0, msg.value);
        break;
      case 'impulseResponse': {
        const samples = msg.data;
        const bytes = samples.length * 4;
        const ptr = w.es_alloc(bytes);
        new Float32Array(w.memory.buffer, ptr, samples.length).set(samples);
        w.es_set_impulse_response(
          this.engine,
          msg.channel === undefined ? -1 : msg.channel,
          ptr,
          samples.length,
          msg.volume === undefined ? 1 : msg.volume,
        );
        w.es_dealloc(ptr, bytes);
        this.view = null;
        break;
      }
      case 'impulseResponseWav': {
        const data = new Uint8Array(msg.bytes);
        const ptr = w.es_alloc(data.length);
        new Uint8Array(w.memory.buffer, ptr, data.length).set(data);
        const result = w.es_set_impulse_response_wav(
          this.engine,
          msg.channel === undefined ? -1 : msg.channel,
          ptr,
          data.length,
          msg.volume === undefined ? 1 : msg.volume,
          sampleRate,
        );
        w.es_dealloc(ptr, data.length);
        this.view = null;
        if (result < 0) {
          this.port.postMessage({ type: 'error', message: `could not decode WAV (${result})` });
        }
        break;
      }
      default:
        break;
    }
  }

  ensureBuffer(length) {
    const w = this.wasm;
    if (this.outputLength !== length) {
      if (this.outputPtr) w.es_dealloc(this.outputPtr, this.outputLength * 4);
      this.outputPtr = w.es_alloc(length * 4);
      this.outputLength = length;
      this.view = null;
    }
    // A wasm memory.grow detaches every existing view.
    if (!this.view || this.view.buffer !== w.memory.buffer) {
      this.view = new Float32Array(w.memory.buffer, this.outputPtr, length);
    }
    return this.view;
  }

  process(inputs, outputs) {
    if (this.disposed || this.failed) return !this.disposed;

    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const frames = output[0].length;

    if (!this.wasm || !this.engine) {
      for (const channel of output) channel.fill(0);
      return true;
    }

    const view = this.ensureBuffer(frames);
    this.wasm.es_render(this.engine, this.outputPtr, frames);

    for (const channel of output) channel.set(view);

    if (--this.telemetryCountdown <= 0) {
      this.telemetryCountdown = this.telemetryInterval;
      this.port.postMessage({
        type: 'telemetry',
        rpm: this.wasm.es_rpm(this.engine),
        manifoldPressure: this.wasm.es_manifold_pressure(this.engine),
        levelerGain: this.wasm.es_leveler_gain(this.engine),
        starterEngaged: this.wasm.es_starter_engaged(this.engine) !== 0,
        gear: this.wasm.es_gear(this.engine),
        speed: this.wasm.es_road_speed(this.engine),
      });
    }

    return true;
  }
}

registerProcessor('engine-sound', EngineSoundProcessor);
