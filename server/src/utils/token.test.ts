import { describe, it, expect, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
} from './token';

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
