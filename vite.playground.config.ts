import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  server: {
    port: 5174,
    strictPort: true,
    // src/shared lives outside the root
    fs: { allow: [resolve(__dirname)] },
  },
});
