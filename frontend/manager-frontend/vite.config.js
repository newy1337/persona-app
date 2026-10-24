import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Куда ходить за данными в dev-режиме: по умолчанию локальный бэкенд, через
  // VITE_API_TARGET в .env.local можно смотреть панель поверх dev-сервера.
  const env = loadEnv(mode, import.meta.dirname, '');
  const target = env.VITE_API_TARGET || 'http://127.0.0.1:8011';
  const proxy = { target, changeOrigin: true, secure: target.startsWith('https') };
  return {
    base: '/',
    plugins: [react(), tailwind()],
    // Vite 8 трансформирует JSX через oxc и эту секцию игнорирует (о чём и
    // предупреждает в dev), а vitest 2 по-прежнему идёт через esbuild —
    // без неё тесты без `import React` падают. Убирать до обновления vitest нельзя.
    esbuild: {
      jsx: 'automatic',
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
    },
    // Тяжёлые страницы (лиды, диалоги) в общем параллельном прогоне не
    // укладываются в 5 секунд по умолчанию, хотя по отдельности проходят быстро.
    test: {
      testTimeout: 20000,
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
