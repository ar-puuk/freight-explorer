import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

// Phase 0: only the spike page is built. Phase 2 replaces `input` with index.html.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: {
    outDir: '../docs',
    emptyOutDir: false,
    rollupOptions: { input: { spike: resolve(__dirname, 'spike.html') } },
  },
  server: { fs: { allow: ['..'] } },
});
