import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

// Загрузка .env независимо от рабочей директории запуска:
// модуль лежит в server/src (или server/dist), .env — в server/
loadEnv({ path: resolve(__dirname, '..', '.env') });

// Драйвер-адаптер Prisma 7 для PostgreSQL (подключение по DATABASE_URL из .env)
const adapter = new PrismaPg({
  connectionString: process.env['DATABASE_URL'],
});

// Единственный экземпляр PrismaClient для всего серверного приложения.
// Повторное создание клиента запрещено: Prisma рекомендует один экземпляр
// на процесс, чтобы не открывать лишние пулы соединений к PostgreSQL.
export const prisma = new PrismaClient({ adapter });

// Корректное завершение работы клиента при остановке процесса
export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
