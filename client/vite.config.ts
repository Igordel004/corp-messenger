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
  },
});
