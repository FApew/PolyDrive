/**
 * React bindings.
 *
 * `useEngineSound` owns the AudioContext and worklet lifecycle. Browsers will
 * not let audio start without a user gesture, so nothing is created until
 * `start()` is called from a click or key press.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngineSound } from './engine-sound.js';

const IDLE_TELEMETRY = {
  rpm: 0,
  gear: 0,
  speed: 0,
  manifoldPressure: 101325,
  levelerGain: 1,
  starterEngaged: false,
};

/**
 * @param {object} [options] forwarded to `createEngineSound`, plus:
 * @param {boolean} [options.autoStart=false] start on mount (only works if the
 *   page already has audio permission, e.g. after a previous gesture)
 * @param {number} [options.telemetryFps=20] how often telemetry state updates
 */
export function useEngineSound(options = {}) {
  const { autoStart = false, telemetryFps = 20, ...engineOptions } = options;

  const engineRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | starting | ready | error
  const [error, setError] = useState(null);
  const [telemetry, setTelemetry] = useState(IDLE_TELEMETRY);

  // Keep the latest options without re-running the effect on every render.
  const optionsRef = useRef(engineOptions);
  optionsRef.current = engineOptions;

  const startingRef = useRef(false);

  const start = useCallback(async () => {
    if (engineRef.current || startingRef.current) return engineRef.current;
    startingRef.current = true;
    setStatus('starting');
    setError(null);

    try {
      const engine = await createEngineSound(optionsRef.current);

      // A context created before a gesture can come up suspended.
      if (engine.context.state === 'suspended') {
        await engine.context.resume();
      }

      let last = 0;
      const minInterval = 1000 / Math.max(1, telemetryFps);
      engine.addEventListener('telemetry', (event) => {
        const now = performance.now();
        if (now - last < minInterval) return;
        last = now;
        setTelemetry({
          rpm: event.detail.rpm,
          manifoldPressure: event.detail.manifoldPressure,
          levelerGain: event.detail.levelerGain,
          starterEngaged: event.detail.starterEngaged,
          gear: event.detail.gear,
          speed: event.detail.speed,
        });
      });
      engine.addEventListener('error', (event) => setError(new Error(event.detail)));

      engineRef.current = engine;
      setStatus('ready');
      return engine;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus('error');
      return null;
    } finally {
      startingRef.current = false;
    }
  }, [telemetryFps]);

  const stop = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engineRef.current = null;
    engine.dispose();
    // Only close contexts we created ourselves.
    if (!optionsRef.current.context) engine.context.close();
    setStatus('idle');
    setTelemetry(IDLE_TELEMETRY);
  }, []);

  useEffect(() => {
    if (autoStart) start();
    return () => {
      const engine = engineRef.current;
      if (!engine) return;
      engineRef.current = null;
      engine.dispose();
      if (!optionsRef.current.context) engine.context.close();
    };
    // Mount/unmount only: `start` is stable and re-running would restart audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setThrottle = useCallback((v) => engineRef.current?.setThrottle(v), []);
  const setStarter = useCallback((v) => engineRef.current?.setStarter(v), []);
  const setIgnition = useCallback((v) => engineRef.current?.setIgnition(v), []);
  const setLoadTorque = useCallback((v) => engineRef.current?.setLoadTorque(v), []);
  const setRpm = useCallback((v) => engineRef.current?.setRpm(v), []);
  const setGear = useCallback((v) => engineRef.current?.setGear(v), []);
  const resetSpeed = useCallback(() => engineRef.current?.resetSpeed(), []);
  const setAudioParam = useCallback((n, v) => engineRef.current?.setAudioParam(n, v), []);
  const setAudioParams = useCallback((p) => engineRef.current?.setAudioParams(p), []);
  const setEngine = useCallback((o) => engineRef.current?.setEngine(o), []);
  const loadMr = useCallback((source) => engineRef.current?.loadMr(source), []);
  const setImpulseResponse = useCallback(
    (r, o) => engineRef.current?.setImpulseResponse(r, o),
    [],
  );
  const loadImpulseResponse = useCallback(
    (url, o) => engineRef.current?.loadImpulseResponse(url, o),
    [],
  );

  return {
    /** 'idle' | 'starting' | 'ready' | 'error' */
    status,
    ready: status === 'ready',
    error,
    /** Live rpm, manifold pressure (Pa) and leveler gain. */
    telemetry,
    /** Call from a click handler. */
    start,
    stop,
    setThrottle,
    setStarter,
    setIgnition,
    setLoadTorque,
    setRpm,
    setGear,
    resetSpeed,
    setAudioParam,
    setAudioParams,
    setEngine,
    loadMr,
    setImpulseResponse,
    loadImpulseResponse,
    /** The underlying EngineSound, once ready. */
    engineRef,
  };
}
