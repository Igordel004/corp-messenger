import { defineConfig } from 'vitest/config';
import { config as loadEnv } from 'dotenv';

// Интеграционные тесты читают server/.env (DATABASE_URL),
// когда Vitest запускается из корня монорепозитория
loadEnv({ path: 'server/.env' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['server/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'server/src/index.ts', 'server/src/generated/**'],
    },
  },
});
