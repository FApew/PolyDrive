// The React hook lives at `engine-sound/react`, not here: `react` is an
// optional peer dependency, and re-exporting the hook from the main entry
// makes every vanilla-JS consumer fail to resolve it.
export { createEngineSound, EngineSound } from './engine-sound.js';
export { buildSpec, deg } from './spec.js';
export {
  PRESETS,
  PRESET_LABELS,
  CONFIG_KEYS,
  AUDIO_KEYS,
  VEHICLE_KEYS,
  DEG,
  MM,
  CM,
  INCH,
  THOU,
  CC,
  LITRE,
  CM2,
  FT_LB,
  PORTS,
  kCarb,
  k28inH2O,
  rpm,
  toRpm,
} from './constants.js';
