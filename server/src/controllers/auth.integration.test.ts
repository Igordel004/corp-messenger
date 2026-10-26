import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from '../app';
import { prisma, disconnectDatabase } from '../data-access/prisma';
import { signAccessToken, hashToken } from '../services/auth';

const regRunId = Date.now();

const cleanupRegisterUsers = async (): Promise<void> => {
  await prisma.user.deleteMany({
    where: { email: { contains: `+test${regRunId}@` } },
  });
};

describe('Integration Test: POST /api/auth/register (PostgreSQL)', () => {
  beforeAll(cleanupRegisterUsers);
  afterAll(async () => {
    await cleanupRegisterUsers();
    await disconnectDatabase();
  });

  it('создаёт аккаунт в PostgreSQL и возвращает 201 без данных пароля', async () => {
    const email = `ivanov+test${regRunId}@corp.messenger.com`;
    const response = await request(app).post('/api/auth/register').send({
      fullName: 'Иванов Иван Иванович',
      email,
      password: 'secretPass123',
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      fullName: 'Иванов Иван Иванович',
      email,
      globalRole: 'USER',
      status: 'ACTIVE',
    });
    expect(response.body).not.toHaveProperty('passwordHash');

    const storedUser = await prisma.user.findUnique({ where: { email } });
    expect(storedUser).not.toBeNull();
    expect(storedUser?.globalRole).toBe('USER');
    expect(storedUser?.status).toBe('ACTIVE');
  });

  it('сохраняет пароль только в виде bcrypt-хэша', async () => {
    const email = `petrov+test${regRunId}@corp.messenger.com`;
    const password = 'secretPass123';

    await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Петров Пётр Петрович', email, password });

    const storedUser = await prisma.user.findUnique({ where: { email } });

    expect(storedUser?.passwordHash).toBeDefined();
    expect(storedUser?.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, storedUser!.passwordHash)).toBe(true);
  });

  it('возвращает 409 при повторной регистрации того же email', async () => {
    const email = `sidorov+test${regRunId}@corp.messenger.com`;
    const payload = {
      fullName: 'Сидоров Сидор Сидорович',
      email,
      password: 'secretPass123',
    };

    const first = await request(app).post('/api/auth/register').send(payload);
    const second = await request(app).post('/api/auth/register').send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);

    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(1);
  });

  it('отклоняет email вне домена @corp.messenger.com с кодом 400', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        fullName: 'Чужой Пользователь',
        email: `user+test${regRunId}@gmail.com`,
        password: 'secretPass123',
      });

    expect(response.status).toBe(400);

    const count = await prisma.user.count({
      where: { email: `user+test${regRunId}@gmail.com` },
    });
    expect(count).toBe(0);
  });

  it('отклоняет короткий пароль (< 8 символов) с кодом 400', async () => {
    const email = `short+test${regRunId}@corp.messenger.com`;
    const response = await request(app).post('/api/auth/register').send({
      fullName: 'Короткий Пароль',
      email,
      password: '12345',
    });

    expect(response.status).toBe(400);

    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(0);
  });
});

const authRunId = Date.now();
const password = 'secretPass123';

const cleanupSessionUsers = async (): Promise<void> => {
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { contains: `+auth${authRunId}@` } },
        { email: { contains: `+rt${authRunId}@` } },
      ],
    },
  });
};

describe('Integration Test: аутентификация и сессия (PostgreSQL)', () => {
  beforeAll(cleanupSessionUsers);
  afterAll(async () => {
    await cleanupSessionUsers();
    await disconnectDatabase();
  });

  it('логин выдаёт токен, /me возвращает данные пользователя', async () => {
    const email = `login+auth${authRunId}@corp.messenger.com`;
    await request(app).post('/api/auth/register').send({
      fullName: 'Тестовый Пользователь',
      email,
      password,
    });

    const login = await request(app).post('/api/auth/login').send({ email, password });

    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe('string');
    expect(typeof login.body.refreshToken).toBe('string');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      id: expect.any(String),
      fullName: 'Тестовый Пользователь',
      email,
      globalRole: 'USER',
      status: 'ACTIVE',
    });
    expect(me.body).not.toHaveProperty('passwordHash');
  });

  it('отклоняет неверный пароль с кодом 401', async () => {
    const email = `wrong+auth${authRunId}@corp.messenger.com`;
    await request(app).post('/api/auth/register').send({
      fullName: 'Неверный Пароль',
      email,
      password,
    });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'incorrectPass1' });

    expect(login.status).toBe(401);
    expect(login.body).not.toHaveProperty('accessToken');
    expect(login.body).not.toHaveProperty('refreshToken');
  });

  it('отклоняет блокированный аккаунт с кодом 403 и уведомлением', async () => {
    const email = `blocked+auth${authRunId}@corp.messenger.com`;
    await request(app).post('/api/auth/register').send({
      fullName: 'Заблокированный Пользователь',
      email,
      password,
    });

    await prisma.user.update({
      where: { email },
      data: { status: 'BLOCKED' },
    });

    const login = await request(app).post('/api/auth/login').send({ email, password });

    expect(login.status).toBe(403);
    expect(login.body).toEqual({
      message: 'Аккаунт заблокирован администратором',
    });
    expect(login.body).not.toHaveProperty('accessToken');
    expect(login.body).not.toHaveProperty('refreshToken');
  });

  it('/me отклоняет запрос без токена (401)', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
  });

  it('/me отклоняет токен с чужой подписью (401)', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer forged.token.value');

    expect(response.status).toBe(401);
  });

  it('/me возвращает 401, если пользователь из токена удалён из БД', async () => {
    const orphanToken = signAccessToken({
      sub: '00000000-0000-4000-8000-000000000000',
      role: 'USER',
    });

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${orphanToken}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Пользователь не найден' });
  });

  it('валидная bcrypt-хэш-проверка на реальном пароле', async () => {
    const email = `hash+auth${authRunId}@corp.messenger.com`;
    await request(app).post('/api/auth/register').send({
      fullName: 'Проверка Хэша',
      email,
      password,
    });

    const stored = await prisma.user.findUnique({ where: { email } });
    expect(stored).not.toBeNull();
    expect(stored!.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, stored!.passwordHash)).toBe(true);
  });
});

describe('Integration Test: ротация и отзыв refresh-токенов (PostgreSQL)', () => {
  const registerAndLogin = async (name: string) => {
    const email = `${name}+rt${authRunId}@corp.messenger.com`;
    await request(app).post('/api/auth/register').send({
      fullName: 'Refresh Тест',
      email,
      password,
    });
    const login = await request(app).post('/api/auth/login').send({ email, password });
    return login.body as { accessToken: string; refreshToken: string };
  };

  const rotate = async (name: string) => {
    const tokens = await registerAndLogin(name);
    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    return {
      oldRefreshToken: tokens.refreshToken,
      newAccessToken: refresh.body.accessToken as string,
    };
  };

  beforeAll(cleanupSessionUsers);
  afterAll(async () => {
    await cleanupSessionUsers();
    await disconnectDatabase();
  });

  it('логин сохраняет refresh-токен хэшем в таблицу refresh_tokens', async () => {
    const tokens = await registerAndLogin('store');

    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(tokens.refreshToken) },
    });

    expect(record).not.toBeNull();
    expect(record?.revokedAt).toBeNull();
    expect(record?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refresh ротирует пару: старый токен перестаёт работать', async () => {
    const tokens = await rotate('rotate');

    const reuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.oldRefreshToken });
    expect(reuse.status).toBe(401);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokens.newAccessToken}`);
    expect(me.status).toBe(200);
  });

  it('logout отзывает refresh-токен: обновление сессии завершается отказом', async () => {
    const tokens = await registerAndLogin('logout');

    const logout = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: tokens.refreshToken });
    expect(logout.status).toBe(200);

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('logout безопасен при повторном вызове с тем же токеном', async () => {
    const tokens = await registerAndLogin('idempotent');

    const first = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: tokens.refreshToken });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: tokens.refreshToken });
    expect(second.status).toBe(200);

    const revoked = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(tokens.refreshToken) },
    });
    expect(revoked?.revokedAt).not.toBeNull();
  });

  it('refresh-токен не принимается в заголовке защищённого маршрута', async () => {
    const tokens = await registerAndLogin('typesplit');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokens.refreshToken}`);

    expect(me.status).toBe(401);
  });

  it('refresh отклоняет токен, отсутствующий в БД', async () => {
    const tokens = await registerAndLogin('deleted');

    await prisma.refreshToken.deleteMany({
      where: { tokenHash: hashToken(tokens.refreshToken) },
    });

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(refresh.status).toBe(401);
  });
});
