import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Dev server proxies /api to the local backend (same origin as production, where nginx does the proxying), so the app
// never needs CORS and the API base URL is always the relative "/api/v1".
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4281,
    // changeOrigin stays false: the Host header is preserved, so the API sees a same-origin request (like nginx does)
    // and no CORS allow-list entry is needed for this dev server.
    proxy: { '/api': { target: 'http://localhost:18480', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/testing/setup.ts'],
    css: false,
  },
});
