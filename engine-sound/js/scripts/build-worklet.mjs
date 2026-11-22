// Regenerates src/worklet-source.js from src/worklet.js.
//
// The worklet has to be registrable from a Blob URL so the package works with
// no build configuration, and a Blob needs the source as a string.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'src', 'worklet.js'), 'utf8');

const out = `// GENERATED FILE - do not edit. Run \`npm run build:worklet\` instead.
// Source: src/worklet.js

export const WORKLET_SOURCE = ${JSON.stringify(source)};
`;

await writeFile(join(here, '..', 'src', 'worklet-source.js'), out);
console.log(`worklet-source.js: ${source.length} bytes embedded`);
