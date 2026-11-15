import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => ({
  root: path.resolve(__dirname, 'web'),
  base: mode === 'pages' ? '/hcm-news-reporter/' : '/',
  plugins: [react()],
  // static GitHub Pages build runs the in-browser demo API (no secrets involved)
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify(mode === 'pages' ? '1' : '') },
  build: {
    outDir: path.resolve(__dirname, mode === 'pages' ? 'dist/pages' : 'dist/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:5178', changeOrigin: false } },
  },
}));
