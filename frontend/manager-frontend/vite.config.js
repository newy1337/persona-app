import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Куда ходить за данными в dev-режиме: по умолчанию локальный бэкенд, через
  // VITE_API_TARGET в .env.local можно смотреть панель поверх dev-сервера.
  const env = loadEnv(mode, __dirname, '');
  const target = env.VITE_API_TARGET || 'http://127.0.0.1:8011';
  const proxy = { target, changeOrigin: true, secure: target.startsWith('https') };
  return {
    base: '/',
    plugins: [react(), tailwind()],
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
        '/api': proxy,
        '/sse': proxy,
        '/auth': proxy,
      },
    },
  };
});
