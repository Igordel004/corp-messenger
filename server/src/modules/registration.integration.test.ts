import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from '../app';
import { prisma, disconnectDatabase } from '../data-access/prisma';

// Уникальный суффикс для тестовых email, чтобы прогоны не конфликтовали
const runId = Date.now();

// Очистка тестовых данных до и после прогона
const cleanupTestUsers = async (): Promise<void> => {
  await prisma.user.deleteMany({
    where: { email: { contains: `+test${runId}@` } },
  });
};

describe('Integration Test: POST /api/auth/register (реальная БД)', () => {
  beforeAll(cleanupTestUsers);
  afterAll(async () => {
    await cleanupTestUsers();
    await disconnectDatabase();
  });

  it('создаёт аккаунт в PostgreSQL и возвращает 201 без данных пароля', async () => {
    const email = `ivanov+test${runId}@corp.messenger.com`;
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

    // Критерий 4: назначены глобальная роль USER и статус ACTIVE
    const storedUser = await prisma.user.findUnique({ where: { email } });
    expect(storedUser).not.toBeNull();
    expect(storedUser?.globalRole).toBe('USER');
    expect(storedUser?.status).toBe('ACTIVE');
  });

  it('сохраняет пароль только в виде bcrypt-хэша', async () => {
    const email = `petrov+test${runId}@corp.messenger.com`;
    const password = 'secretPass123';

    await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Петров Пётр Петрович', email, password });

    const storedUser = await prisma.user.findUnique({ where: { email } });

    // Критерий 3: открытого пароля в БД нет, хэш верифицируется bcrypt
    expect(storedUser?.passwordHash).toBeDefined();
    expect(storedUser?.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, storedUser!.passwordHash)).toBe(true);
  });

  it('возвращает 409 при повторной регистрации того же email', async () => {
    const email = `sidorov+test${runId}@corp.messenger.com`;
    const payload = {
      fullName: 'Сидоров Сидор Сидорович',
      email,
      password: 'secretPass123',
    };

    const first = await request(app).post('/api/auth/register').send(payload);
    const second = await request(app).post('/api/auth/register').send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);

    // Аккаунт остался ровно один
    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(1);
  });

  it('отклоняет email вне домена @corp.messenger.com с кодом 400', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        fullName: 'Чужой Пользователь',
        email: `user+test${runId}@gmail.com`,
        password: 'secretPass123',
      });

    expect(response.status).toBe(400);

    const count = await prisma.user.count({
      where: { email: `user+test${runId}@gmail.com` },
    });
    expect(count).toBe(0);
  });

  it('отклоняет короткий пароль (< 8 символов) с кодом 400', async () => {
    const email = `short+test${runId}@corp.messenger.com`;
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
