import { resolve } from 'node:path';
import sirv from 'sirv';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// In dev, serve the committed data (../docs/data) at /data, with range requests, exactly like the built site.
function serveData(): Plugin {
  return {
    name: 'serve-docs-data',
    configureServer(server) {
      server.middlewares.use('/data', sirv(resolve(import.meta.dirname, '../docs/data'), { dev: true, etag: true }));
    },
  };
}

// Builds into ../docs (GitHub Pages root). Relative base so it works under /<repo>/. emptyOutDir is false so docs/data survives;
// scripts/clean.mjs removes the previous hashed assets first.
export default defineConfig({
  base: './',
  plugins: [svelte(), serveData()],
  build: {
    outDir: '../docs',
    emptyOutDir: false,
  },
  server: { fs: { allow: ['..'] } },
});
