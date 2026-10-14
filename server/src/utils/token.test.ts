import { describe, it, expect, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { signSessionToken, verifySessionToken, type SessionPayload } from './token';

const TEST_SECRET = 'token-unit-test-secret';

const payload: SessionPayload = {
  sub: 'user-uuid-1',
  role: 'USER',
};

describe('Unit Test: Утилита токенов сессии (JWT)', () => {
  afterEach(() => {
    process.env['JWT_SECRET'] = TEST_SECRET;
  });

  it('подписывает токен и возвращает строку', () => {
    process.env['JWT_SECRET'] = TEST_SECRET;
    const token = signSessionToken(payload);

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('верифицирует собственный токен и возвращает исходную нагрузку', () => {
    process.env['JWT_SECRET'] = TEST_SECRET;
    const token = signSessionToken(payload);

    expect(verifySessionToken(token)).toEqual(payload);
  });

  it('отклоняет токен, подписанный другим секретом', () => {
    const foreignToken = jwt.sign(payload, 'another-secret', {
      expiresIn: '24h',
    });

    expect(() => verifySessionToken(foreignToken)).toThrow();
  });

  it('отклоняет токен с некорректной полезной нагрузкой', () => {
    // Токен корректно подписан, но без обязательных полей sub и role
    const malformedToken = jwt.sign({ foo: 'bar' }, TEST_SECRET, {
      expiresIn: '24h',
    });

    expect(() => verifySessionToken(malformedToken)).toThrow(
      'Некорректная полезная нагрузка токена',
    );
  });

  it('падает с понятной ошибкой при отсутствии JWT_SECRET', () => {
    delete process.env['JWT_SECRET'];

    expect(() => signSessionToken(payload)).toThrow('Переменная окружения JWT_SECRET не задана');
    expect(() => verifySessionToken('any.token.value')).toThrow(
      'Переменная окружения JWT_SECRET не задана',
    );
  });
});
