/**
 * A complete React example.
 *
 * Browsers require a user gesture before audio can start, so nothing is created
 * until the Start button is pressed.
 */

import { useEffect, useState } from 'react';
import { PRESETS, PRESET_LABELS } from 'engine-sound';
import { useEngineSound } from 'engine-sound/react';

export default function EngineDemo() {
  const [preset, setPreset] = useState('v8_crossplane');
  const [throttle, setThrottle] = useState(0);
  const [load, setLoad] = useState(0);

  const engine = useEngineSound({ preset, audio: { volume: 0.7 } });
  const { ready, status, error, telemetry } = engine;

  // Swap engines in place, without tearing down the audio graph.
  useEffect(() => {
    if (!ready) return;
    engine.setEngine({ preset });
    engine.setStarter(true);
  }, [preset, ready]);

  useEffect(() => {
    if (ready) engine.setThrottle(throttle);
  }, [throttle, ready]);

  useEffect(() => {
    if (ready) engine.setLoadTorque(load);
  }, [load, ready]);

  async function handleStart() {
    const created = await engine.start();
    if (created) {
      created.setThrottle(throttle);
      created.setLoadTorque(load);
      created.setStarter(true); // disengages by itself once it catches
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((id) => (
            <option key={id} value={id}>
              {PRESET_LABELS[id]}
            </option>
          ))}
        </select>

        {ready ? (
          <button onClick={engine.stop}>Stop</button>
        ) : (
          <button onClick={handleStart} disabled={status === 'starting'}>
            {status === 'starting' ? 'Starting…' : 'Start audio'}
          </button>
        )}

        {ready && <button onClick={() => engine.setStarter(true)}>Starter</button>}
      </div>

      <label>
        Throttle
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={throttle}
          disabled={!ready}
          onChange={(e) => setThrottle(Number(e.target.value))}
          onMouseUp={() => setThrottle(0)}
        />
      </label>

      <label>
        Load ({load} N·m)
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={load}
          disabled={!ready}
          onChange={(e) => setLoad(Number(e.target.value))}
        />
      </label>

      <output style={{ fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(telemetry.rpm)} rpm · {(telemetry.manifoldPressure / 1000).toFixed(0)} kPa
      </output>

      {error && <p style={{ color: 'crimson' }}>{error.message}</p>}
    </div>
  );
}
