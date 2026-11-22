// Builds the Rust crate for wasm32 and copies the artifact next to the JS.
//
// Only needs a stable Rust toolchain with the wasm32-unknown-unknown target:
//   rustup target add wasm32-unknown-unknown
//
// No wasm-pack or wasm-bindgen: the crate exports a flat C ABI, so the .wasm
// is loadable as-is.

import { execFileSync } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const crateDir = resolve(here, '..', '..');
const target = 'wasm32-unknown-unknown';

console.log(`building ${crateDir} for ${target}`);
execFileSync('cargo', ['build', '--release', '--target', target], {
  cwd: crateDir,
  stdio: 'inherit',
});

const artifact = join(crateDir, 'target', target, 'release', 'engine_sound.wasm');
const destination = join(here, '..', 'src', 'engine_sound.wasm');
copyFileSync(artifact, destination);

const { size } = statSync(destination);
console.log(`engine_sound.wasm: ${(size / 1024).toFixed(1)} KiB -> ${destination}`);
