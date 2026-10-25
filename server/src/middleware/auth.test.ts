import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth, createRequireAdmin } from './auth';
import { signAccessToken } from '../services/auth';

process.env['JWT_SECRET'] = 'middleware-unit-test-secret';

const createTestApp = () => {
  const app = express();
  app.get('/protected', requireAuth, (req, res) => {
    res.status(200).json({ session: req.session });
  });
  return app;
};

describe('Unit Test: Middleware проверки токена сессии', () => {
  beforeEach(() => {
    process.env['JWT_SECRET'] = 'middleware-unit-test-secret';
  });

  it('пропускает запрос с валидным токеном и прикрепляет payload', async () => {
    const token = signAccessToken({ sub: 'user-uuid-1', role: 'USER' });
    const response = await request(createTestApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.session).toEqual({
      sub: 'user-uuid-1',
      role: 'USER',
      type: 'access',
    });
  });

  it('возвращает 401 без заголовка Authorization', async () => {
    const response = await request(createTestApp()).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Требуется авторизация' });
  });

  it('возвращает 401 при заголовке без схемы Bearer', async () => {
    const token = signAccessToken({ sub: 'user-uuid-1', role: 'USER' });
    const response = await request(createTestApp()).get('/protected').set('Authorization', token);

    expect(response.status).toBe(401);
  });

  it('возвращает 401 при токене с чужой подписью', async () => {
    const foreignToken = jwt.sign({ sub: 'user-uuid-1', role: 'USER' }, 'another-secret', {
      expiresIn: '24h',
    });
    const response = await request(createTestApp())
      .get('/protected')
      .set('Authorization', `Bearer ${foreignToken}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      message: 'Невалидный или истёкший токен',
    });
  });

  it('возвращает 401 при произвольной строке вместо токена', async () => {
    const response = await request(createTestApp())
      .get('/protected')
      .set('Authorization', 'Bearer not-a-jwt');

    expect(response.status).toBe(401);
  });

  it('возвращает 401 при истёкшем токене', async () => {
    const expiredToken = jwt.sign(
      { sub: 'user-uuid-1', role: 'USER', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env['JWT_SECRET']!,
      { algorithm: 'HS256' },
    );
    const response = await request(createTestApp())
      .get('/protected')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(response.status).toBe(401);
  });

  it('возвращает 401 при токене без обязательных полей sub и role', async () => {
    const malformedToken = jwt.sign({ foo: 'bar' }, process.env['JWT_SECRET']!, {
      expiresIn: '24h',
    });
    const response = await request(createTestApp())
      .get('/protected')
      .set('Authorization', `Bearer ${malformedToken}`);

    expect(response.status).toBe(401);
  });
});

describe('Unit Test: Middleware проверки роли администратора', () => {
  beforeEach(() => {
    process.env['JWT_SECRET'] = 'middleware-unit-test-secret';
  });

  const createAdminApp = (globalRole: 'USER' | 'ADMIN' | null) => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(globalRole ? { globalRole } : null) },
    };
    const app = express();
    app.get('/admin', requireAuth, createRequireAdmin(prisma as never), (req, res) => {
      res.status(200).json({ session: req.session });
    });
    return app;
  };

  it('пропускает запрос с глобальной ролью ADMIN в базе', async () => {
    const token = signAccessToken({ sub: 'admin-uuid-1', role: 'ADMIN' });
    const response = await request(createAdminApp('ADMIN'))
      .get('/admin')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('возвращает 403 пользователю с ролью USER', async () => {
    const token = signAccessToken({ sub: 'user-uuid-1', role: 'USER' });
    const response = await request(createAdminApp('USER'))
      .get('/admin')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: 'Доступ запрещён: требуется роль администратора',
    });
  });

  it('роль в базе важнее роли в токене: назначение действует без перелогина', async () => {
    const token = signAccessToken({ sub: 'user-uuid-1', role: 'USER' });
    const response = await request(createAdminApp('ADMIN'))
      .get('/admin')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('роль в базе важнее роли в токене: снятие роли блокирует доступ сразу', async () => {
    const token = signAccessToken({ sub: 'admin-uuid-1', role: 'ADMIN' });
    const response = await request(createAdminApp('USER'))
      .get('/admin')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('возвращает 403 для несуществующего пользователя', async () => {
    const token = signAccessToken({ sub: 'ghost-uuid', role: 'ADMIN' });
    const response = await request(createAdminApp(null))
      .get('/admin')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('возвращает 401 без токена до проверки роли', async () => {
    const response = await request(createAdminApp('ADMIN')).get('/admin');

    expect(response.status).toBe(401);
  });
});
