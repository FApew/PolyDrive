/**
 * The generated artefacts have to match their sources.
 *
 * `worklet-source.js` is a string copy of `worklet.js`, and `engine_sound.wasm`
 * is built from the crate. Both are committed so the package works with no
 * build step, and both are easy to forget to regenerate — at which point the
 * tests keep passing against a stale copy while the browser runs old code.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { WORKLET_SOURCE } from '../src/worklet-source.js';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

test('worklet-source.js is up to date with worklet.js', async () => {
  const source = await readFile(path('../src/worklet.js'), 'utf8');
  assert.equal(
    WORKLET_SOURCE,
    source,
    'src/worklet-source.js is stale — run `npm run build:worklet`',
  );
});

test('the embedded worklet is valid JavaScript that registers a processor', () => {
  let registered = null;
  const evaluate = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    WORKLET_SOURCE,
  );
  evaluate(class {}, (name) => {
    registered = name;
  }, 44100);
  assert.equal(registered, 'engine-sound');
});

test('the wasm is newer than the Rust it is built from', async () => {
  const wasm = await stat(path('../src/engine_sound.wasm'));

  const sources = [
    '../../src/lib.rs',
    '../../src/ffi.rs',
    '../../src/config.rs',
    '../../src/engine.rs',
    '../../src/sim.rs',
    '../../src/synth.rs',
    '../../src/mr/mod.rs',
    '../../src/mr/eval.rs',
    '../../src/mr/to_config.rs',
  ];

  for (const relative of sources) {
    const source = await stat(path(relative));
    assert.ok(
      wasm.mtimeMs >= source.mtimeMs,
      `${relative} is newer than the wasm — run \`npm run build:wasm\``,
    );
  }
});

test('every function the worklet calls is exported by the wasm', async () => {
  const bytes = await readFile(path('../src/engine_sound.wasm'));
  const exports = new Set(
    WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map((e) => e.name),
  );

  const source = await readFile(path('../src/worklet.js'), 'utf8');
  const called = new Set([...source.matchAll(/\bw\.(es_\w+)/g)].map((m) => m[1]));

  assert.ok(called.size > 10, 'did not find the wasm calls to check');
  for (const name of called) {
    assert.ok(exports.has(name), `the worklet calls ${name}, which the wasm does not export`);
  }
});
