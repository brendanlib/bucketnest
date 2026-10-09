/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `vite build --mode static-demo` makes the website's read-only demo: the same app,
 * served from /demo/app/, answering the API in the browser from a recorded snapshot
 * (STATIC_DEMO_FIXTURES, made by e2e/scripts/record-static-demo.ts).
 */
function staticDemoFixtures(): Plugin {
  return {
    name: 'static-demo-fixtures',
    generateBundle() {
      const file = process.env.STATIC_DEMO_FIXTURES;
      if (!file) throw new Error('Set STATIC_DEMO_FIXTURES to the recorded snapshot (see e2e/scripts/record-static-demo.ts)');
      this.emitFile({ type: 'asset', fileName: 'fixtures.json', source: readFileSync(resolve(file)) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const staticDemo = mode === 'static-demo';
  return {
    plugins: [react(), ...(staticDemo ? [staticDemoFixtures()] : [])],
    base: staticDemo ? (process.env.STATIC_DEMO_BASE ?? '/demo/app/') : '/',
    define: staticDemo ? { 'import.meta.env.VITE_STATIC_DEMO': JSON.stringify('true') } : {},
    server: {
      port: 5173,
      // Same-origin in development too: the browser only ever talks to /api.
      proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: false } },
    },
    build: { sourcemap: false, chunkSizeWarningLimit: 900, outDir: staticDemo ? 'dist-static-demo' : 'dist' },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      css: false,
    },
  };
});
