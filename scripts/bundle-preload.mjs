/**
 * Bundles src/preload/index.ts into a SINGLE self-contained CJS file at
 * dist/main/preload/index.js.
 *
 * Electron sandboxed preloads (sandbox: true, the default since Electron 20)
 * use a polyfilled `require` that can only load built-ins ('electron', events,
 * timers, url) — it CANNOT load separate CommonJS files such as
 * ../shared/ipc. The preload must therefore be fully bundled.
 *
 * Runs after `tsc -p tsconfig.node.json`, overwriting its per-file emit.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/main/preload/index.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});

console.log('preload bundled → dist/main/preload/index.js');
