/* global Buffer, console */
// Writes src/shared/defaults.json from DEFAULT_SETTINGS (embedded by the Rust shell via include_str!).
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = await build({
  entryPoints: [resolve(root, 'src/shared/defaults.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  logLevel: 'warning',
});
const code = out.outputFiles[0].text;
const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
writeFileSync(resolve(root, 'src/shared/defaults.json'), JSON.stringify(mod.DEFAULT_SETTINGS, null, 2) + '\n');
console.log('wrote src/shared/defaults.json');
