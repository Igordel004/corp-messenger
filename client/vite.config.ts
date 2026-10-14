import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Базовый путь для продакшен-сборки: GitHub Pages разворачивает проект
// в подпапке /corp-messenger/, поэтому ассеты и маршруты должны на неё ссылаться.
// В dev-режиме используется корень.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/corp-messenger/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    // Проксирование API-запросов на сервер разработки (Node.js/Express)
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
}));
