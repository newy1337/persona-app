import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/',
  plugins: [react()],
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8011', changeOrigin: true },
      '/sse': { target: 'http://127.0.0.1:8011', changeOrigin: true },
      '/auth': { target: 'http://127.0.0.1:8011', changeOrigin: true },
    },
  },
});
