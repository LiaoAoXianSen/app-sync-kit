import { build } from 'esbuild';

const entryPoint = 'packages/browser/src/index.ts';

await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  outfile: 'packages/browser/dist/app-sync-kit.browser.js'
});

await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'iife',
  globalName: 'AppSyncKit',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  outfile: 'packages/browser/dist/app-sync-kit.browser.global.js'
});
