import { describe, it, expect, vi } from 'vitest';
import {
  hashToken,
  storeRefreshToken,
  findRefreshToken,
  isRefreshTokenUsable,
  revokeRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from './refresh-tokens';

const TOKEN = 'refresh.jwt.token';
const USER_ID = 'user-uuid-1';

const record = {
  id: 'rt-1',
  userId: USER_ID,
  expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  revokedAt: null as Date | null,
};

describe('Unit Test: Репозиторий refresh-токенов', () => {
  it('хэширует токен перед сохранением', async () => {
    const create = vi.fn().mockResolvedValue(record);
    const prisma = { refreshToken: { create } };

    await storeRefreshToken(prisma as never, USER_ID, TOKEN);

    // В БД уходит SHA-256, а не открытый токен
    const saved = create.mock.calls[0][0].data;
    expect(saved.tokenHash).toBe(hashToken(TOKEN));
    expect(saved.tokenHash).not.toBe(TOKEN);
    expect(saved.tokenHash).toHaveLength(64);
  });

  it('вычисляет срок истечения из времени жизни', async () => {
    const create = vi.fn().mockResolvedValue(record);
    const prisma = { refreshToken: { create } };
    const before = Date.now();

    await storeRefreshToken(prisma as never, USER_ID, TOKEN);

    const saved = create.mock.calls[0][0].data;
    expect(saved.expiresAt.getTime()).toBeGreaterThanOrEqual(before + REFRESH_TOKEN_TTL_MS);
  });

  it('находит запись по открытому токену через хэш', async () => {
    const findUnique = vi.fn().mockResolvedValue(record);
    const prisma = { refreshToken: { findUnique } };

    const found = await findRefreshToken(prisma as never, TOKEN);

    expect(findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(TOKEN) },
    });
    expect(found?.userId).toBe(USER_ID);
  });

  it('возвращает null при отсутствии токена', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { refreshToken: { findUnique } };

    expect(await findRefreshToken(prisma as never, TOKEN)).toBeNull();
  });

  it('пригоден неотозванный и неистёкший токен', () => {
    expect(isRefreshTokenUsable(record)).toBe(true);
  });

  it('непригоден отозванный токен', () => {
    expect(isRefreshTokenUsable({ ...record, revokedAt: new Date() })).toBe(false);
  });

  it('непригоден истёкший токен', () => {
    expect(isRefreshTokenUsable({ ...record, expiresAt: new Date(Date.now() - 1000) })).toBe(false);
  });

  it('отзыв устанавливает отметку времени', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = { refreshToken: { update } };

    await revokeRefreshToken(prisma as never, 'rt-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'rt-1' },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
