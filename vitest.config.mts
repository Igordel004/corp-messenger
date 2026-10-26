import { defineConfig } from 'vitest/config';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: 'server/.env' });

if (!process.env['CI'] && process.env['DATABASE_URL']) {
  const testUrl = process.env['DATABASE_URL'].replace(
    /\/corp_messenger(?=[/?]|$)/,
    '/corp_messenger_test',
  );
  if (testUrl === process.env['DATABASE_URL']) {
    throw new Error(
      'DATABASE_URL не указывает на базу corp_messenger — тесты остановлены, чтобы не задеть рабочие данные',
    );
  }
  process.env['DATABASE_URL'] = testUrl;
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['vitest.global-setup.mts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['server/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'server/src/index.ts', 'server/src/generated/**'],
    },
  },
});
