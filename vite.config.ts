import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Use './' as base so that built assets use relative paths.
  // This is required for Electron to load them via the file:// protocol.
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
    // Exclude backend data files from Vite's chokidar watcher.
    // Without this, writing server/db.json during analysis triggers a full page reload
    // because Vite watches ALL project files by default.
    watch: {
      ignored: [
        '**/server/db.json',
        '**/data/**',
        '**/node_modules/**',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  },
});
