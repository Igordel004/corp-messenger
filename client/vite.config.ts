import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Конфигурация сборщика клиентского SPA
export default defineConfig({
  plugins: [react()],
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
});
