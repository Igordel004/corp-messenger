import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// .env ищется от каталога модуля, а не от cwd: скрипты запускаются из разных директорий
loadEnv({ path: resolve(__dirname, '..', '..', '.env') });

const adapter = new PrismaPg({
  connectionString: process.env['DATABASE_URL'],
});

// Один экземпляр клиента на процесс — иначе каждый импорт открывал бы свой пул соединений
export const prisma = new PrismaClient({ adapter });

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
