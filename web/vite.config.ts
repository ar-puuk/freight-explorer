import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Builds into ../docs (GitHub Pages root). Relative base so it works under /<repo>/. emptyOutDir is false so docs/data survives;
// scripts/clean.mjs removes the previous hashed assets first.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: {
    outDir: '../docs',
    emptyOutDir: false,
  },
  server: { fs: { allow: ['..'] } },
});
