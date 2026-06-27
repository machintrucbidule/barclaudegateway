/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The app version is the root package.json (the release source of truth; the per-package versions are
// not maintained). Inject it at build time so the UI can show it without an extra runtime request.
const appVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  .version as string;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  // Dev only: the React app runs on Vite (5173) and the API/scan routes on the backend (8090).
  // Proxying keeps a single origin in the browser (no CORS) and works for SSE too. In production the
  // backend serves the built bundle, so this proxy is never used there.
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8090', changeOrigin: true },
      '/v1': { target: 'http://localhost:8090', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // Only run TypeScript sources, never bundled output in dist/.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
