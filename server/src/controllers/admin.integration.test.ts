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

  it('роль, назначенная в БД, действует без перелогина', async () => {
    await prisma.user.update({
      where: { id: USER_ID },
      data: { globalRole: 'ADMIN' },
    });

    const staleToken = userToken();
    const response = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${staleToken}`);

    expect(response.status).toBe(200);

    await prisma.user.update({
      where: { id: USER_ID },
      data: { globalRole: 'USER' },
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

  it('блокировка меняет статус на BLOCKED, разблокировка возвращает ACTIVE', async () => {
    const block = await request(app)
      .patch(`/api/admin/users/${USER_ID}/status`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'BLOCKED' });

    expect(block.status).toBe(200);
    expect(block.body.status).toBe('BLOCKED');

    const stored = await prisma.user.findUnique({ where: { id: USER_ID } });
    expect(stored?.status).toBe('BLOCKED');

    const unblock = await request(app)
      .patch(`/api/admin/users/${USER_ID}/status`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'ACTIVE' });

    expect(unblock.status).toBe(200);
    expect(unblock.body.status).toBe('ACTIVE');
  });

  it('назначает и снимает глобальную роль ADMIN', async () => {
    const promote = await request(app)
      .patch(`/api/admin/users/${USER_ID}/role`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ globalRole: 'ADMIN' });

    expect(promote.status).toBe(200);
    expect(promote.body.globalRole).toBe('ADMIN');

    const demote = await request(app)
      .patch(`/api/admin/users/${USER_ID}/role`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ globalRole: 'USER' });

    expect(demote.status).toBe(200);
    expect(demote.body.globalRole).toBe('USER');
  });

  it('запрещает администратору блокировать самого себя', async () => {
    const response = await request(app)
      .patch(`/api/admin/users/${ADMIN_ID}/status`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'BLOCKED' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: 'Действия над собственной учётной записью запрещены',
    });

    const stored = await prisma.user.findUnique({ where: { id: ADMIN_ID } });
    expect(stored?.status).toBe('ACTIVE');
  });

  it('запрещает администратору снимать роль ADMIN с самого себя', async () => {
    const response = await request(app)
      .patch(`/api/admin/users/${ADMIN_ID}/role`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ globalRole: 'USER' });

    expect(response.status).toBe(403);

    const stored = await prisma.user.findUnique({ where: { id: ADMIN_ID } });
    expect(stored?.globalRole).toBe('ADMIN');
  });

  it('пользователь с ролью USER получает 403 на изменение', async () => {
    const response = await request(app)
      .patch(`/api/admin/users/${USER_ID}/status`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ status: 'BLOCKED' });

    expect(response.status).toBe(403);
  });

  it('отклоняет некорректные значения статуса и роли', async () => {
    const badStatus = await request(app)
      .patch(`/api/admin/users/${USER_ID}/status`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'DELETED' });

    expect(badStatus.status).toBe(400);

    const badRole = await request(app)
      .patch(`/api/admin/users/${USER_ID}/role`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ globalRole: 'GUEST' });

    expect(badRole.status).toBe(400);

    const emptyStatus = await request(app)
      .patch(`/api/admin/users/${USER_ID}/status`)
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(emptyStatus.status).toBe(400);

    const emptyRole = await request(app)
      .patch(`/api/admin/users/${USER_ID}/role`)
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(emptyRole.status).toBe(400);
  });

  it('возвращает 404 для несуществующего сотрудника', async () => {
    const response = await request(app)
      .patch('/api/admin/users/00000000-0000-4000-8000-000000000000/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'BLOCKED' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Сотрудник не найден' });
  });
});
