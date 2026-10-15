import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from '../app';
import { prisma, disconnectDatabase } from '../db';
import { signAccessToken } from '../utils/token';

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

    // Критерий 1: валидная пара даёт токен
    expect(login.status).toBe(200);
    expect(typeof login.body.token).toBe('string');

    // Критерий 4: токен открывает доступ к защищённому маршруту
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`);

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
    expect(login.body).not.toHaveProperty('token');
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
    expect(login.body).not.toHaveProperty('token');
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
