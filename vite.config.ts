/// <reference types="vitest" />
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';
import Pages from 'vite-plugin-pages';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(),
    Pages({
      // The cross designer (editor.tsx) is opened almost every session, so
      // its route is loaded synchronously (folded into the main bundle)
      // instead of lazily - confirmed via timing instrumentation that the
      // lazy chunk's one-time load/parse cost, not any data fetch or
      // render work, was responsible for a ~1.7s delay on first open.
      // Every other route keeps the default lazy/async behavior.
      importMode: (filepath) =>
        filepath.includes('/editor.tsx') ? 'sync' : 'async',
    }),
  ],

  // Vite optons tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  // prevent vite from obscuring rust errors
  clearScreen: false,
  // tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Vite never serves or transforms anything under src-tauri (Rust source
    // isn't part of the frontend bundle at all) - Tauri's own separate CLI
    // watcher already handles rebuilding the backend on source changes, so
    // Vite watching this tree too is pure redundant overhead. Worse,
    // src-tauri/target is a constantly-churning incremental build directory
    // (hundreds of thousands of files during a Rust compile) that isn't
    // gitignored out of Vite's default watch scope - every backend rebuild
    // was flooding Vite's own file watcher with a storm of change events,
    // which is almost certainly what's been causing the dev server's
    // repeated CPU-thrashing/restart-loop behavior today.
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  // to make use of `TAURI_DEBUG` and other env variables
  // https://tauri.studio/v1/api/config#buildconfig.beforedevcommand
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Tauri supports es2021
    target: ['es2021', 'chrome100', 'safari13'],
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
