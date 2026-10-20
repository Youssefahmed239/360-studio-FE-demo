import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Builds a reusable, self-bootstrapping public tour player. It is generated into
// public/ so the editor can download it during development and Vite copies it into dist.
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: resolve(process.cwd(), 'public/player-runtime'),
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    lib: {
      entry: resolve(process.cwd(), 'src/player/runtime.ts'),
      name: 'TourPlayerRuntime',
      formats: ['iife'],
      fileName: () => 'tour-player.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'tour-player.css', inlineDynamicImports: true },
    },
  },
});
