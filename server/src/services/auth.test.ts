import { describe, it, expect, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  REFRESH_TOKEN_TTL_MS,
  validateCorporateEmail,
  validatePassword,
  hashToken,
  storeRefreshToken,
  findRefreshToken,
  isRefreshTokenUsable,
  revokeRefreshToken,
} from './auth';

const SECRET = 'unit-test-secret';
const payload = { sub: 'user-uuid-1', role: 'USER' as const };

describe('Unit Test: Токены сессии (JWT)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('Время жизни токенов', () => {
    it('access-токен живёт 15 минут', () => {
      expect(ACCESS_TOKEN_TTL).toBe('15m');
    });

    it('refresh-токен живёт 7 дней', () => {
      expect(REFRESH_TOKEN_TTL).toBe('7d');
    });
  });

  describe('Подпись и верификация', () => {
    it('access-токен проходит верификацию и содержит вид access', () => {
      vi.stubEnv('JWT_SECRET', SECRET);
      const decoded = verifyAccessToken(signAccessToken(payload));

      expect(decoded.sub).toBe(payload.sub);
      expect(decoded.role).toBe('USER');
      expect(decoded.type).toBe('access');
    });

    it('refresh-токен проходит верификацию и содержит вид refresh', () => {
      vi.stubEnv('JWT_SECRET', SECRET);
      const decoded = verifyRefreshToken(signRefreshToken(payload));

      expect(decoded.sub).toBe(payload.sub);
      expect(decoded.type).toBe('refresh');
    });

    it('отклоняет токен, подписанный другим секретом', () => {
      vi.stubEnv('JWT_SECRET', SECRET);
      const foreign = jwt.sign({ ...payload, type: 'access' }, 'other-secret', {
        expiresIn: '15m',
      });

      expect(() => verifyAccessToken(foreign)).toThrow();
    });

    it('отклоняет токен с отсутствующими полями sub и role', () => {
      vi.stubEnv('JWT_SECRET', SECRET);
      const malformed = jwt.sign({ type: 'access' }, SECRET, { expiresIn: '15m' });

      expect(() => verifyAccessToken(malformed)).toThrow('Некорректная полезная нагрузка токена');
    });

    it('отклоняет токен с неожиданным видом', () => {
      vi.stubEnv('JWT_SECRET', SECRET);
      const wrongType = jwt.sign({ ...payload, type: 'admin' }, SECRET, { expiresIn: '15m' });

      expect(() => verifyAccessToken(wrongType)).toThrow('Некорректная полезная нагрузка токена');
    });
  });

  describe('Разделение видов токенов', () => {
    it('refresh-токен не принимается как токен доступа', () => {
      vi.stubEnv('JWT_SECRET', SECRET);
      const refreshToken = signRefreshToken(payload);

      expect(() => verifyAccessToken(refreshToken)).toThrow(
        'Некорректная полезная нагрузка токена',
      );
    });

    it('access-токен не принимается как токен обновления', () => {
      vi.stubEnv('JWT_SECRET', SECRET);
      const accessToken = signAccessToken(payload);

      expect(() => verifyRefreshToken(accessToken)).toThrow(
        'Некорректная полезная нагрузка токена',
      );
    });

    it('refresh-токены уникальны даже при выпуске в одну секунду', () => {
      vi.stubEnv('JWT_SECRET', SECRET);
      const first = signRefreshToken(payload);
      const second = signRefreshToken(payload);

      expect(first).not.toBe(second);
    });
  });

  describe('Окружение', () => {
    it('падает с понятной ошибкой при отсутствии JWT_SECRET', () => {
      vi.stubEnv('JWT_SECRET', undefined);

      expect(() => signAccessToken(payload)).toThrow('Переменная окружения JWT_SECRET не задана');
      expect(() => signRefreshToken(payload)).toThrow('Переменная окружения JWT_SECRET не задана');
    });
  });
});

describe('Unit Test: Валидация учетных данных сотрудника', () => {
  it('должен принимать корректный корпоративный email', () => {
    expect(validateCorporateEmail('employee@corp.messenger.com')).toBe(true);
  });

  it('должен отклонять сторонний публичный email', () => {
    expect(validateCorporateEmail('user@gmail.com')).toBe(false);
  });

  it('должен проверять минимальную длину пароля (от 8 символов)', () => {
    expect(validatePassword('secretPass123')).toBe(true);
    expect(validatePassword('12345')).toBe(false);
  });
});

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
