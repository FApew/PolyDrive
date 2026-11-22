import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSpec, deg } from '../src/spec.js';
import { AUDIO_KEYS, CONFIG_KEYS, PRESETS } from '../src/constants.js';

test('resolves preset names to ABI ids', () => {
  for (const [index, preset] of PRESETS.entries()) {
    assert.equal(buildSpec({ preset }).presetId, index);
  }
});

test('defaults to a v8 when no preset is given', () => {
  assert.equal(buildSpec().presetId, PRESETS.indexOf('v8_crossplane'));
});

test('resolves parameter names to numeric keys', () => {
  const spec = buildSpec({
    params: { bore: 0.1, revLimit: 700 },
    audio: { volume: 0.5, jitter: 0.2 },
  });

  assert.deepEqual(
    spec.params.sort((a, b) => a[0] - b[0]),
    [
      [CONFIG_KEYS.bore, 0.1],
      [CONFIG_KEYS.revLimit, 700],
    ].sort((a, b) => a[0] - b[0]),
  );
  assert.deepEqual(
    spec.audio.sort((a, b) => a[0] - b[0]),
    [
      [AUDIO_KEYS.volume, 0.5],
      [AUDIO_KEYS.jitter, 0.2],
    ].sort((a, b) => a[0] - b[0]),
  );
});

test('rejects non-numeric parameter values', () => {
  assert.throws(() => buildSpec({ params: { bore: 'big' } }), /finite number/);
  assert.throws(() => buildSpec({ params: { bore: NaN } }), /finite number/);
});

test('a custom layout requires a firing order', () => {
  assert.throws(
    () =>
      buildSpec({
        layout: {
          banks: [0],
          exhausts: [{}],
          cylinders: [{ journalAngle: 0 }, { journalAngle: deg(180) }],
        },
      }),
    /firingOrder/,
  );
});

test('the firing order must cover every cylinder', () => {
  assert.throws(
    () =>
      buildSpec({
        layout: {
          banks: [0],
          exhausts: [{}],
          cylinders: [{ journalAngle: 0 }, { journalAngle: deg(180) }],
        },
        firingOrder: [0],
      }),
    /lists 1 cylinders but the layout has 2/,
  );
});

test('cylinders cannot reference banks or exhausts that do not exist', () => {
  assert.throws(
    () =>
      buildSpec({
        layout: { banks: [0], exhausts: [{}], cylinders: [{ bank: 3 }] },
        firingOrder: [0],
      }),
    /references bank 3/,
  );

  assert.throws(
    () =>
      buildSpec({
        layout: { banks: [0], exhausts: [{}], cylinders: [{ exhaust: 2 }] },
        firingOrder: [0],
      }),
    /references exhaust 2/,
  );
});

test('an empty layout is rejected', () => {
  assert.throws(() => buildSpec({ layout: { banks: [], exhausts: [{}], cylinders: [{}] }, firingOrder: [0] }), /banks/);
  assert.throws(() => buildSpec({ layout: { banks: [0], exhausts: [], cylinders: [{}] }, firingOrder: [0] }), /exhausts/);
  assert.throws(() => buildSpec({ layout: { banks: [0], exhausts: [{}], cylinders: [] }, firingOrder: [] }), /cylinders/);
});

test('layout entries fall back to sensible defaults', () => {
  const spec = buildSpec({
    layout: {
      banks: [deg(45), { angle: deg(-45) }],
      exhausts: [{}, { length: 3 }],
      cylinders: [{}, { bank: 1, exhaust: 1 }],
    },
    firingOrder: [0, 1],
  });

  assert.deepEqual(spec.layout.banks, [deg(45), deg(-45)]);
  assert.equal(spec.layout.exhausts[1][0], 3);
  assert.equal(spec.layout.cylinders[0][0], 0);
  assert.equal(spec.layout.cylinders[1][0], 1);
  assert.ok(spec.firingOrder instanceof Uint32Array);
});

test('cam options fill in the exhaust side from the intake side', () => {
  const spec = buildSpec({ cam: { intakeDuration: 4, intakeLift: 0.012 } });
  assert.deepEqual(spec.cam, [4, 0.012, 4, 0.012, 0.9]);
});
