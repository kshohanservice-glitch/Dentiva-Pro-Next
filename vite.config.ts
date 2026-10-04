import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => ({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, 'src/shared') },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome128',
    chunkSizeWarningLimit: 900,
    // `--mode e2e` (npm run test:e2e): readable identifiers + inline source maps
    // so Playwright pageerror stacks point at real TypeScript sources.
    sourcemap: mode === 'e2e' ? 'inline' : false,
    minify: mode === 'e2e' ? false : true,
  },
  server: { port: 5173, strictPort: true },
}));
