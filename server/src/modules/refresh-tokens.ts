import { createHash } from 'crypto';
import { type PrismaClient } from '../generated/prisma/client';

// Срок жизни refresh-токена: 7 дней
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Хэш токена для хранения в БД. Открытый токен в базу не попадает,
// поэтому утечка таблицы не даёт возможности подделать сессию.
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

// Данные новой записи refresh-токена
export interface StoredRefreshToken {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

// Сохранение refresh-токена после выдачи пары токенов
export const storeRefreshToken = async (
  prisma: PrismaClient,
  userId: string,
  token: string,
): Promise<StoredRefreshToken> => {
  const record = await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return {
    id: record.id,
    userId: record.userId,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
  };
};

// Поиск записи по хэшу токена
export const findRefreshToken = async (
  prisma: PrismaClient,
  token: string,
): Promise<StoredRefreshToken | null> => {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!record) {
    return null;
  }

  return {
    id: record.id,
    userId: record.userId,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
  };
};

// Проверка пригодности токена: не истёк и не отозван
export const isRefreshTokenUsable = (record: StoredRefreshToken): boolean =>
  record.revokedAt === null && record.expiresAt.getTime() > Date.now();

// Отзыв токена (выход из системы, ротация при обновлении)
export const revokeRefreshToken = async (prisma: PrismaClient, tokenId: string): Promise<void> => {
  await prisma.refreshToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  });
};
