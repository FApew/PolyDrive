/**
 * Turns a friendly engine description into the flat, numeric spec the worklet
 * applies through the ABI.
 */

import { AUDIO_KEYS, CONFIG_KEYS, DEG, PORTS, PRESETS, VEHICLE_KEYS } from './constants.js';

function presetId(preset) {
  const index = PRESETS.indexOf(preset);
  if (index < 0) {
    throw new Error(
      `unknown preset "${preset}". Expected one of: ${PRESETS.join(', ')}`,
    );
  }
  return index;
}

/**
 * JSON has no comments, and an engine definition is exactly the kind of file
 * that wants them. Any key starting with an underscore is ignored, everywhere.
 */
const isComment = (name) => name.startsWith('_');

function resolveKeys(source, table, label) {
  const out = [];
  for (const [name, value] of Object.entries(source || {})) {
    if (isComment(name)) continue;
    const key = table[name];
    if (key === undefined) {
      throw new Error(`unknown ${label} "${name}"`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${label} "${name}" must be a finite number`);
    }
    out.push([key, value]);
  }
  return out;
}

/**
 * @param {object} options
 * @param {string} [options.preset] one of PRESETS; defaults to 'v8_crossplane'
 * @param {object} [options.params] CONFIG_KEYS name -> value
 * @param {object} [options.audio] AUDIO_KEYS name -> value
 * @param {object} [options.cam] { intakeDuration, intakeLift, exhaustDuration, exhaustLift, gamma }
 * @param {object} [options.layout] custom layout, replaces the preset's
 * @param {number[]} [options.firingOrder] cylinder indices in firing order
 */
export function buildSpec(options = {}) {
  const spec = {
    presetId: presetId(options.preset || 'v8_crossplane'),
    params: resolveKeys(options.params, CONFIG_KEYS, 'engine parameter'),
    audio: resolveKeys(options.audio, AUDIO_KEYS, 'audio parameter'),
  };

  if (options.vehicle) {
    spec.vehicle = resolveKeys(options.vehicle, VEHICLE_KEYS, 'vehicle parameter');
  }

  if (options.gears) {
    if (!Array.isArray(options.gears) || options.gears.length === 0) {
      throw new Error('gears must be a non-empty array of ratios, first to top');
    }
    for (const ratio of options.gears) {
      if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) {
        throw new Error(`gear ratio ${ratio} must be a positive number`);
      }
    }
    spec.gears = options.gears.slice();
  }

  if (options.name !== undefined) {
    if (typeof options.name !== 'string') {
      throw new Error('name must be a string');
    }
    // Encoded here: the worklet has no TextEncoder.
    spec.nameBytes = new TextEncoder().encode(options.name);
  }

  if (options.portFlow) {
    spec.portFlow = [];
    for (const [name, key] of Object.entries(PORTS)) {
      const curve = options.portFlow[name];
      if (!curve) continue;
      if (!Array.isArray(curve) || curve.length === 0) {
        throw new Error(`portFlow.${name} must be a non-empty array of [lift, scfm]`);
      }
      for (const point of curve) {
        if (!Array.isArray(point) || point.length !== 2) {
          throw new Error(`portFlow.${name} entries must be [liftMetres, scfm]`);
        }
        if (!point.every((v) => typeof v === 'number' && Number.isFinite(v))) {
          throw new Error(`portFlow.${name} entries must be finite numbers`);
        }
      }
      spec.portFlow.push([
        key,
        curve.map((p) => p[0]),
        curve.map((p) => p[1]),
        options.portFlow.filterRadius ?? 0,
      ]);
    }
  }

  if (options.cam) {
    const c = options.cam;
    spec.cam = [
      c.intakeDuration ?? 0,
      c.intakeLift ?? 0,
      c.exhaustDuration ?? c.intakeDuration ?? 0,
      c.exhaustLift ?? c.intakeLift ?? 0,
      c.gamma ?? 0.9,
    ];
  }

  if (options.layout) {
    const l = options.layout;

    if (!Array.isArray(l.banks) || l.banks.length === 0) {
      throw new Error('layout.banks must list at least one bank angle');
    }
    if (!Array.isArray(l.exhausts) || l.exhausts.length === 0) {
      throw new Error('layout.exhausts must list at least one exhaust system');
    }
    if (!Array.isArray(l.cylinders) || l.cylinders.length === 0) {
      throw new Error('layout.cylinders must list at least one cylinder');
    }

    spec.layout = {
      // Bank angle from vertical, radians.
      banks: l.banks.map((b) => (typeof b === 'number' ? b : b.angle)),
      exhausts: l.exhausts.map((e) => [
        e.length ?? 2.54,
        e.collectorArea ?? 0.002,
        e.outletFlowScfm ?? 1000,
        e.primaryTubeLength ?? 0.74,
        e.primaryFlowScfm ?? 600,
        e.velocityDecay ?? 0.5,
        e.audioVolume ?? 0.2,
      ]),
      cylinders: l.cylinders.map((c, i) => {
        const bank = c.bank ?? 0;
        if (bank >= l.banks.length) {
          throw new Error(`cylinder ${i} references bank ${bank}, which does not exist`);
        }
        const exhaust = c.exhaust ?? 0;
        if (exhaust >= l.exhausts.length) {
          throw new Error(`cylinder ${i} references exhaust ${exhaust}, which does not exist`);
        }
        return [
          bank,
          c.journalAngle ?? 0,
          exhaust,
          c.soundAttenuation ?? 1,
          c.headerPrimaryLength ?? 0.02,
        ];
      }),
    };
  }

  const order = options.firingOrder;
  if (order) {
    const cylinderCount = spec.layout ? spec.layout.cylinders.length : null;
    if (cylinderCount !== null && order.length !== cylinderCount) {
      throw new Error(
        `firingOrder lists ${order.length} cylinders but the layout has ${cylinderCount}`,
      );
    }
    spec.firingOrder = Uint32Array.from(order);
  } else if (spec.layout) {
    throw new Error('a custom layout also needs a firingOrder');
  }

  return spec;
}

/** Handy for building custom layouts. */
export const deg = (value) => value * DEG;
