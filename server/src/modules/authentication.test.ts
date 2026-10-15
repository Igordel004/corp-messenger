import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import bcrypt from 'bcrypt';
import { createAuthenticationRouter } from './authentication';
import { verifyAccessToken } from '../utils/token';
import { type PrismaClient } from '../generated/prisma/client';

// Секрет подписи токенов для тестового окружения
process.env['JWT_SECRET'] = 'unit-test-secret';

// Тестовые данные
const validCredentials = {
  email: 'ivanov@corp.messenger.com',
  password: 'secretPass123',
};

const passwordHash = bcrypt.hashSync(validCredentials.password, 4);

const activeUser = {
  id: 'user-uuid-1',
  fullName: 'Иванов Иван Иванович',
  email: validCredentials.email,
  passwordHash,
  globalRole: 'USER' as const,
  status: 'ACTIVE' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Мок PrismaClient: findUnique возвращает активного пользователя
const createMockPrisma = () => ({
  user: {
    findUnique: vi.fn().mockResolvedValue(activeUser),
  },
});

const createTestApp = (mockPrisma: ReturnType<typeof createMockPrisma>) => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthenticationRouter(mockPrisma as unknown as PrismaClient));
  return app;
};

describe('Unit Test: Модуль аутентификации (выдача токена)', () => {
  it('выдаёт валидный токен по паре email и пароль (200)', async () => {
    const mock = createMockPrisma();
    const response = await request(createTestApp(mock))
      .post('/api/auth/login')
      .send(validCredentials);

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe('string');

    // Токен верифицируется и содержит идентификатор и роль пользователя
    const payload = verifyAccessToken(response.body.token);
    expect(payload.sub).toBe(activeUser.id);
    expect(payload.role).toBe('USER');
  });

  it('возвращает 401 при неверном пароле', async () => {
    const mock = createMockPrisma();
    const response = await request(createTestApp(mock))
      .post('/api/auth/login')
      .send({ ...validCredentials, password: 'wrongPassword1' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Неверный email или пароль' });
  });

  it('возвращает 401 при несуществующем email', async () => {
    const mock = createMockPrisma();
    mock.user.findUnique.mockResolvedValue(null);

    const response = await request(createTestApp(mock))
      .post('/api/auth/login')
      .send(validCredentials);

    expect(response.status).toBe(401);
  });

  it('возвращает 403 с уведомлением о блокировке для заблокированного аккаунта', async () => {
    const mock = createMockPrisma();
    mock.user.findUnique.mockResolvedValue({
      ...activeUser,
      status: 'BLOCKED' as const,
    });

    const response = await request(createTestApp(mock))
      .post('/api/auth/login')
      .send(validCredentials);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: 'Аккаунт заблокирован администратором',
    });
  });

  it('отклоняет email вне домена @corp.messenger.com с кодом 400', async () => {
    const mock = createMockPrisma();
    const response = await request(createTestApp(mock))
      .post('/api/auth/login')
      .send({ ...validCredentials, email: 'user@gmail.com' });

    expect(response.status).toBe(400);
    expect(mock.user.findUnique).not.toHaveBeenCalled();
  });

  it('отклоняет запрос без строковых полей с кодом 400', async () => {
    const mock = createMockPrisma();
    const response = await request(createTestApp(mock))
      .post('/api/auth/login')
      .send({ email: 123, password: null });

    expect(response.status).toBe(400);
    expect(mock.user.findUnique).not.toHaveBeenCalled();
  });

  it('отклоняет запрос без тела с кодом 400', async () => {
    const mock = createMockPrisma();
    const response = await request(createTestApp(mock)).post('/api/auth/login');

    expect(response.status).toBe(400);
    expect(mock.user.findUnique).not.toHaveBeenCalled();
  });
});
