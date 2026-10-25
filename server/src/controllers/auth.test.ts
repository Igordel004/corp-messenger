import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import bcrypt from 'bcrypt';
import { createAuthRouter } from './auth';
import {
  AuthService,
  verifyAccessToken,
  verifyRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from '../services/auth';
import { type PrismaClient } from '../generated/prisma/client';

const validInput = {
  fullName: 'Иванов Иван Иванович',
  email: 'ivanov@corp.messenger.com',
  password: 'secretPass123',
};

const createdUser = {
  id: 'user-uuid-1',
  fullName: validInput.fullName,
  email: validInput.email,
  globalRole: 'USER' as const,
  status: 'ACTIVE' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  passwordHash: 'hash',
};

const createRegisterMock = () => ({
  user: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(createdUser),
  },
});

const createRegisterApp = (mockPrisma: ReturnType<typeof createRegisterMock>) => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(new AuthService(mockPrisma as unknown as PrismaClient)));
  return app;
};

describe('Unit Test: Модуль регистрации сотрудников', () => {
  it('создаёт аккаунт и возвращает 201 без данных пароля', async () => {
    const mock = createRegisterMock();
    const response = await request(createRegisterApp(mock))
      .post('/api/auth/register')
      .send(validInput);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: 'user-uuid-1',
      fullName: validInput.fullName,
      email: validInput.email,
      globalRole: 'USER',
      status: 'ACTIVE',
    });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('хэширует пароль bcrypt перед сохранением в БД', async () => {
    const mock = createRegisterMock();
    await request(createRegisterApp(mock)).post('/api/auth/register').send(validInput);

    const createCall = mock.user.create.mock.calls[0][0];
    const savedHash = createCall.data.passwordHash;

    expect(savedHash).not.toBe(validInput.password);
    expect(await bcrypt.compare(validInput.password, savedHash)).toBe(true);
  });

  it('отклоняет email вне домена @corp.messenger.com с кодом 400', async () => {
    const mock = createRegisterMock();
    const response = await request(createRegisterApp(mock))
      .post('/api/auth/register')
      .send({ ...validInput, email: 'user@gmail.com' });

    expect(response.status).toBe(400);
    expect(mock.user.create).not.toHaveBeenCalled();
  });

  it('отклоняет короткий пароль (< 8 символов) с кодом 400', async () => {
    const mock = createRegisterMock();
    const response = await request(createRegisterApp(mock))
      .post('/api/auth/register')
      .send({ ...validInput, password: '12345' });

    expect(response.status).toBe(400);
    expect(mock.user.create).not.toHaveBeenCalled();
  });

  it('отклоняет пустое имя с кодом 400', async () => {
    const mock = createRegisterMock();
    const response = await request(createRegisterApp(mock))
      .post('/api/auth/register')
      .send({ ...validInput, fullName: '   ' });

    expect(response.status).toBe(400);
    expect(mock.user.create).not.toHaveBeenCalled();
  });

  it('отклоняет запрос без тела с кодом 400', async () => {
    const mock = createRegisterMock();
    const response = await request(createRegisterApp(mock)).post('/api/auth/register');

    expect(response.status).toBe(400);
    expect(mock.user.create).not.toHaveBeenCalled();
  });

  it('возвращает 409 при попытке регистрации занятого email', async () => {
    const mock = createRegisterMock();
    mock.user.findUnique.mockResolvedValue(createdUser);

    const response = await request(createRegisterApp(mock))
      .post('/api/auth/register')
      .send(validInput);

    expect(response.status).toBe(409);
    expect(mock.user.create).not.toHaveBeenCalled();
  });

  it('обрабатывает гонку уникальности (P2002) как 409', async () => {
    const mock = createRegisterMock();
    mock.user.create.mockRejectedValue({ code: 'P2002' });

    const response = await request(createRegisterApp(mock))
      .post('/api/auth/register')
      .send(validInput);

    expect(response.status).toBe(409);
  });

  it('пробрасывает непредвиденную ошибку БД как 500', async () => {
    const mock = createRegisterMock();
    mock.user.create.mockRejectedValue(new Error('connection lost'));

    const response = await request(createRegisterApp(mock))
      .post('/api/auth/register')
      .send(validInput);

    expect(response.status).toBe(500);
  });
});

process.env['JWT_SECRET'] = 'unit-test-secret';

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

const storedRecord = {
  id: 'rt-1',
  userId: activeUser.id,
  expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  revokedAt: null as Date | null,
};

const createLoginMock = () => ({
  user: {
    findUnique: vi.fn().mockResolvedValue(activeUser),
  },
  refreshToken: {
    create: vi.fn().mockResolvedValue(storedRecord),
    findUnique: vi.fn().mockResolvedValue(storedRecord),
    update: vi.fn().mockResolvedValue({}),
  },
});

const createLoginApp = (mockPrisma: ReturnType<typeof createLoginMock>) => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(new AuthService(mockPrisma as unknown as PrismaClient)));
  return app;
};

describe('Unit Test: Модуль аутентификации (пара токенов)', () => {
  it('выдаёт пару access и refresh токенов (200)', async () => {
    const mock = createLoginMock();
    const response = await request(createLoginApp(mock))
      .post('/api/auth/login')
      .send(validCredentials);

    expect(response.status).toBe(200);
    expect(typeof response.body.accessToken).toBe('string');
    expect(typeof response.body.refreshToken).toBe('string');

    const access = verifyAccessToken(response.body.accessToken);
    expect(access.sub).toBe(activeUser.id);
    expect(access.role).toBe('USER');
    expect(access.type).toBe('access');

    const refresh = verifyRefreshToken(response.body.refreshToken);
    expect(refresh.sub).toBe(activeUser.id);
    expect(refresh.type).toBe('refresh');
  });

  it('сохраняет refresh-токен в БД перед отправкой клиенту', async () => {
    const mock = createLoginMock();
    const response = await request(createLoginApp(mock))
      .post('/api/auth/login')
      .send(validCredentials);

    expect(mock.refreshToken.create).toHaveBeenCalledTimes(1);
    const savedHash = mock.refreshToken.create.mock.calls[0][0].data.tokenHash;
    expect(savedHash).toHaveLength(64);
    expect(savedHash).not.toBe(response.body.refreshToken);
  });

  it('возвращает 401 при неверном пароле', async () => {
    const mock = createLoginMock();
    const response = await request(createLoginApp(mock))
      .post('/api/auth/login')
      .send({ ...validCredentials, password: 'wrongPassword1' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Неверный email или пароль' });
  });

  it('возвращает 401 при несуществующем email', async () => {
    const mock = createLoginMock();
    mock.user.findUnique.mockResolvedValue(null);

    const response = await request(createLoginApp(mock))
      .post('/api/auth/login')
      .send(validCredentials);

    expect(response.status).toBe(401);
  });

  it('возвращает 403 с уведомлением о блокировке для заблокированного аккаунта', async () => {
    const mock = createLoginMock();
    mock.user.findUnique.mockResolvedValue({
      ...activeUser,
      status: 'BLOCKED' as const,
    });

    const response = await request(createLoginApp(mock))
      .post('/api/auth/login')
      .send(validCredentials);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: 'Аккаунт заблокирован администратором',
    });
  });

  it('отклоняет email вне домена @corp.messenger.com с кодом 400', async () => {
    const mock = createLoginMock();
    const response = await request(createLoginApp(mock))
      .post('/api/auth/login')
      .send({ ...validCredentials, email: 'user@gmail.com' });

    expect(response.status).toBe(400);
    expect(mock.user.findUnique).not.toHaveBeenCalled();
  });

  it('отклоняет запрос без строковых полей с кодом 400', async () => {
    const mock = createLoginMock();
    const response = await request(createLoginApp(mock))
      .post('/api/auth/login')
      .send({ email: 123, password: null });

    expect(response.status).toBe(400);
    expect(mock.user.findUnique).not.toHaveBeenCalled();
  });

  it('отклоняет запрос без тела с кодом 400', async () => {
    const mock = createLoginMock();
    const response = await request(createLoginApp(mock)).post('/api/auth/login');

    expect(response.status).toBe(400);
    expect(mock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('Unit Test: Обновление сессии (POST /refresh)', () => {
  const login = async (mock: ReturnType<typeof createLoginMock>) => {
    const response = await request(createLoginApp(mock))
      .post('/api/auth/login')
      .send(validCredentials);
    return response.body as { accessToken: string; refreshToken: string };
  };

  it('ротирует пару: старый refresh отзывается, выдаётся новая пара', async () => {
    const mock = createLoginMock();
    const tokens = await login(mock);

    const response = await request(createLoginApp(mock))
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(response.status).toBe(200);
    expect(typeof response.body.accessToken).toBe('string');
    expect(typeof response.body.refreshToken).toBe('string');
    expect(response.body.refreshToken).not.toBe(tokens.refreshToken);

    expect(mock.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: storedRecord.id } }),
    );
    expect(mock.refreshToken.create).toHaveBeenCalledTimes(2);
  });

  it('берёт роль из БД, а не из устаревшей нагрузки токена', async () => {
    const mock = createLoginMock();
    mock.user.findUnique.mockResolvedValue({
      ...activeUser,
      globalRole: 'ADMIN' as const,
    });
    const tokens = await login(mock);

    const response = await request(createLoginApp(mock))
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(response.status).toBe(200);
    expect(verifyAccessToken(response.body.accessToken).role).toBe('ADMIN');
  });

  it('отклоняет refresh-токен заблокированного пользователя и отзывает его', async () => {
    const mock = createLoginMock();
    const tokens = await login(mock);
    mock.user.findUnique.mockResolvedValue({
      ...activeUser,
      status: 'BLOCKED' as const,
    });

    const response = await request(createLoginApp(mock))
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(response.status).toBe(401);
    expect(mock.refreshToken.update).toHaveBeenCalled();
    expect(mock.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('отклоняет запись, отсутствующую в БД', async () => {
    const mock = createLoginMock();
    const tokens = await login(mock);
    mock.refreshToken.findUnique.mockResolvedValue(null);

    const response = await request(createLoginApp(mock))
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(response.status).toBe(401);
  });

  it('отклоняет отозванную запись', async () => {
    const mock = createLoginMock();
    const tokens = await login(mock);
    mock.refreshToken.findUnique.mockResolvedValue({
      ...storedRecord,
      revokedAt: new Date(),
    });

    const response = await request(createLoginApp(mock))
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(response.status).toBe(401);
  });

  it('отклоняет произвольную строку вместо токена', async () => {
    const mock = createLoginMock();
    const response = await request(createLoginApp(mock))
      .post('/api/auth/refresh')
      .send({ refreshToken: 'not-a-jwt' });

    expect(response.status).toBe(401);
    expect(mock.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('отклоняет запрос без refresh-токена с кодом 400', async () => {
    const mock = createLoginMock();
    const response = await request(createLoginApp(mock)).post('/api/auth/refresh');

    expect(response.status).toBe(400);
  });
});

describe('Unit Test: Выход из системы (POST /logout)', () => {
  const loginRefreshToken = async (mock: ReturnType<typeof createLoginMock>) => {
    const response = await request(createLoginApp(mock))
      .post('/api/auth/login')
      .send(validCredentials);
    return (response.body as { refreshToken: string }).refreshToken;
  };

  it('отзывает действующий refresh-токен', async () => {
    const mock = createLoginMock();
    const refreshToken = await loginRefreshToken(mock);

    const response = await request(createLoginApp(mock))
      .post('/api/auth/logout')
      .send({ refreshToken });

    expect(response.status).toBe(200);
    expect(mock.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: storedRecord.id } }),
    );
  });

  it('успешен даже с невалидным токеном (идемпотентность)', async () => {
    const mock = createLoginMock();
    const response = await request(createLoginApp(mock))
      .post('/api/auth/logout')
      .send({ refreshToken: 'garbage-string' });

    expect(response.status).toBe(200);
    expect(mock.refreshToken.update).not.toHaveBeenCalled();
  });

  it('успешен без тела запроса', async () => {
    const mock = createLoginMock();
    const response = await request(createLoginApp(mock)).post('/api/auth/logout');

    expect(response.status).toBe(200);
    expect(mock.refreshToken.update).not.toHaveBeenCalled();
  });
});
