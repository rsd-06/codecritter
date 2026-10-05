import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The page imports the real overlay engine from ../src (not copied), so the dev server must be
// allowed to read the repo root and `@shared` must resolve like it does in the app.
export default defineConfig({
  root: __dirname,
  base: '/',
  resolve: { alias: { '@shared': resolve(__dirname, '../src/shared') } },
  server: { port: 5180, fs: { allow: [resolve(__dirname, '..')] } },
  preview: { port: 5181 },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false },
});
