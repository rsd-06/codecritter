import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend build for the Tauri shell (overlay + settings pages, multi-page).
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  clearScreen: false,
  plugins: [react()],
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  server: {
    port: 5175,
    strictPort: true,
    fs: { allow: [resolve(__dirname)] },
  },
  build: {
    outDir: resolve(__dirname, 'dist-tauri'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
        settings: resolve(__dirname, 'src/renderer/settings/index.html'),
      },
    },
  },
});
