import { describe, it, expect, afterEach } from 'vitest';
import { prisma, disconnectDatabase } from './db';

describe('Database Module: подключение Prisma к приложению', () => {
  afterEach(async () => {
    await disconnectDatabase();
  });

  it('экспортирует единый экземпляр PrismaClient', () => {
    expect(prisma).toBeDefined();
    expect(prisma.$connect).toBeInstanceOf(Function);
    expect(prisma.$disconnect).toBeInstanceOf(Function);
  });

  it('повторный импорт возвращает тот же экземпляр (singleton)', async () => {
    const secondImport = await import('./db');

    expect(secondImport.prisma).toBe(prisma);
  });
});
