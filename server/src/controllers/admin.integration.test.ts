import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma, disconnectDatabase } from '../data-access/prisma';
import { signAccessToken } from '../services/auth';

const RUN_ID = Date.now();
const ADMIN_ID = `adminuser-${RUN_ID}`;
const USER_ID = `plainuser-${RUN_ID}`;
const MATCH_ID = `matchuser-${RUN_ID}`;

const adminToken = (): string => signAccessToken({ sub: ADMIN_ID, role: 'ADMIN' });
const userToken = (): string => signAccessToken({ sub: USER_ID, role: 'USER' });

const createUsers = async (): Promise<void> => {
  await prisma.user.createMany({
    data: [
      {
        id: ADMIN_ID,
        fullName: 'Админ Реестра',
        email: `adminuser-${RUN_ID}@corp.messenger.com`,
        passwordHash: 'test-hash',
        globalRole: 'ADMIN',
        status: 'ACTIVE',
      },
      {
        id: USER_ID,
        fullName: 'Обычный Сотрудник',
        email: `plainuser-${RUN_ID}@corp.messenger.com`,
        passwordHash: 'test-hash',
        globalRole: 'USER',
        status: 'ACTIVE',
      },
      {
        id: MATCH_ID,
        fullName: 'Находка Поиска',
        email: `matchuser-${RUN_ID}@corp.messenger.com`,
        passwordHash: 'test-hash',
        globalRole: 'USER',
        status: 'BLOCKED',
      },
    ],
  });
};

const cleanup = async (): Promise<void> => {
  await prisma.user.deleteMany({
    where: { id: { in: [ADMIN_ID, USER_ID, MATCH_ID] } },
  });
};

describe('Integration Test: GET /api/admin/users (реальная БД)', () => {
  beforeAll(async () => {
    await cleanup();
    await createUsers();
  });

  afterAll(async () => {
    await cleanup();
    await disconnectDatabase();
  });

  it('пользователь с ролью USER получает 403', async () => {
    const response = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${userToken()}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: 'Доступ запрещён: требуется роль администратора',
    });
  });

  it('администратор получает реестр с полями имени, email, роли и статуса', async () => {
    const response = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThanOrEqual(3);

    const record = response.body.find((u: { id: string }) => u.id === MATCH_ID);
    expect(record).toEqual({
      id: MATCH_ID,
      fullName: 'Находка Поиска',
      email: `matchuser-${RUN_ID}@corp.messenger.com`,
      globalRole: 'USER',
      status: 'BLOCKED',
    });
  });

  it('поиск фильтрует по имени', async () => {
    const response = await request(app)
      .get('/api/admin/users?search=Находка')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe(MATCH_ID);
  });

  it('поиск фильтрует по email', async () => {
    const response = await request(app)
      .get(`/api/admin/users?search=plainuser-${RUN_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe(USER_ID);
  });

  it('возвращает 401 без токена', async () => {
    const response = await request(app).get('/api/admin/users');

    expect(response.status).toBe(401);
  });
});
