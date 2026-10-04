import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const shared = resolve(__dirname, 'src/shared');

/**
 * Sandboxed preloads cannot require relative chunk files. Both preload entries import
 * shared/ipc, which would make Rollup emit a shared chunk. Give each importer its own
 * module id (query suffix) so the constants are duplicated into each bundle instead.
 */
function selfContainedPreload(): Plugin {
  return {
    name: 'critter:self-contained-preload',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !/(^|\/)shared\/ipc$/.test(source.split('\\').join('/'))) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r) return null;
      const tag = importer.split('\\').join('/').split('/').pop()!.replace(/\.ts$/, '');
      return `${r.id}?preload=${tag}`;
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ include: ['uiohook-napi', 'get-windows'] })],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['uiohook-napi', 'get-windows'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), selfContainedPreload()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
          settings: resolve(__dirname, 'src/preload/settings.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
        },
      },
    },
  },
});
