import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from '../app';
import { prisma, disconnectDatabase } from '../data-access/prisma';
import { signAccessToken } from '../utils/token';
import { hashToken } from './refresh-tokens';

// Уникальный суффикс для тестовых email, чтобы прогоны не конфликтовали
const runId = Date.now();
const password = 'secretPass123';

const cleanupTestUsers = async (): Promise<void> => {
  await prisma.user.deleteMany({
    where: { email: { contains: `+auth${runId}@` } },
  });
};

describe('Integration Test: аутентификация и сессия (реальная БД)', () => {
  beforeAll(cleanupTestUsers);
  afterAll(async () => {
    await cleanupTestUsers();
    await disconnectDatabase();
  });

  it('логин выдаёт токен, /me возвращает данные пользователя', async () => {
    const email = `login+auth${runId}@corp.messenger.com`;
    await request(app).post('/api/auth/register').send({
      fullName: 'Тестовый Пользователь',
      email,
      password,
    });

    const login = await request(app).post('/api/auth/login').send({ email, password });

    // Критерий 1: валидная пара даёт пару токенов
    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe('string');
    expect(typeof login.body.refreshToken).toBe('string');

    // Критерий 4: токен открывает доступ к защищённому маршруту
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
    // Открытый пароль и хэш не должны возвращаться наружу
    expect(me.body).not.toHaveProperty('passwordHash');
  });

  it('отклоняет неверный пароль с кодом 401', async () => {
    const email = `wrong+auth${runId}@corp.messenger.com`;
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
    const email = `blocked+auth${runId}@corp.messenger.com`;
    await request(app).post('/api/auth/register').send({
      fullName: 'Заблокированный Пользователь',
      email,
      password,
    });

    // Имитация блокировки: статус меняется напрямую в БД
    await prisma.user.update({
      where: { email },
      data: { status: 'BLOCKED' },
    });

    const login = await request(app).post('/api/auth/login').send({ email, password });

    // Критерий 3: сервер отклоняет вход и выводит уведомление о блокировке
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
    // Валидно подписанный токен, но его владелец не существует в БД
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
    const email = `hash+auth${runId}@corp.messenger.com`;
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

describe('Integration Test: ротация и отзыв refresh-токенов (реальная БД)', () => {
  // Регистрация и вход тестового пользователя
  const registerAndLogin = async (name: string) => {
    const email = `${name}+rt${runId}@corp.messenger.com`;
    await request(app).post('/api/auth/register').send({
      fullName: 'Refresh Тест',
      email,
      password,
    });
    const login = await request(app).post('/api/auth/login').send({ email, password });
    return login.body as { accessToken: string; refreshToken: string };
  };

  // Вход и ротация пары: возвращает старый refresh и новую пару
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

  beforeAll(cleanupTestUsers);
  afterAll(async () => {
    await cleanupTestUsers();
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

    // Старый refresh отозван
    const reuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.oldRefreshToken });
    expect(reuse.status).toBe(401);

    // Новая пара работает: новый access открывает защищённый маршрут
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

    // Первый вызов отзывает запись
    const first = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: tokens.refreshToken });
    expect(first.status).toBe(200);

    // Второй вызов: токен валиден, но запись уже отозвана — путь без отзыва
    const second = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: tokens.refreshToken });
    expect(second.status).toBe(200);

    const revoked = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(tokens.refreshToken) },
    });
    // Отзыв не продублирован
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

    // Токен валиден криптографически, но его запись удалена
    await prisma.refreshToken.deleteMany({
      where: { tokenHash: hashToken(tokens.refreshToken) },
    });

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(refresh.status).toBe(401);
  });
});
