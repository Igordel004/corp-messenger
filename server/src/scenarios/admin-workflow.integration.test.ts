import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma, disconnectDatabase } from '../data-access/prisma';

const RUN_ID = Date.now();
const PASSWORD = 'secretPass123';

const ADMIN_EMAIL = `chief-${RUN_ID}@corp.messenger.com`;
const STAFF_EMAIL = `staff-${RUN_ID}@corp.messenger.com`;
const STAFF_NAME = `Сергей Иванов-${RUN_ID}`;

const cleanup = async (): Promise<void> => {
  await prisma.user.deleteMany({
    where: { email: { in: [ADMIN_EMAIL, STAFF_EMAIL] } },
  });
};

const registerUser = async (fullName: string, email: string): Promise<void> => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ fullName, email, password: PASSWORD });
  expect(response.status).toBe(201);
};

const loginUser = async (email: string): Promise<string> => {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return response.body.accessToken as string;
};

describe('Сценарий: администратор управляет сотрудниками', () => {
  beforeAll(async () => {
    await cleanup();
    await registerUser(STAFF_NAME, STAFF_EMAIL);
    await registerUser('Главный Администратор', ADMIN_EMAIL);
    await prisma.user.update({
      where: { email: ADMIN_EMAIL },
      data: { globalRole: 'ADMIN' },
    });
  });

  afterAll(async () => {
    await cleanup();
    await disconnectDatabase();
  });

  it('назначение роли, блокировка и разблокировка сотрудника', async () => {
    const adminToken = await loginUser(ADMIN_EMAIL);
    const staffToken = await loginUser(STAFF_EMAIL);

    const forbidden = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(forbidden.status).toBe(403);

    const registry = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(registry.status).toBe(200);
    const record = registry.body.find((user: { email: string }) => user.email === STAFF_EMAIL);
    expect(record).toMatchObject({
      fullName: STAFF_NAME,
      email: STAFF_EMAIL,
      globalRole: 'USER',
      status: 'ACTIVE',
    });
    const staffId = record.id as string;
    const adminId = (
      registry.body.find((user: { email: string }) => user.email === ADMIN_EMAIL) as { id: string }
    ).id;

    const found = await request(app)
      .get(`/api/admin/users?search=${encodeURIComponent(STAFF_NAME)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(found.body).toHaveLength(1);

    const promoted = await request(app)
      .patch(`/api/admin/users/${staffId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ globalRole: 'ADMIN' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.globalRole).toBe('ADMIN');

    const selfAction = await request(app)
      .patch(`/api/admin/users/${adminId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'BLOCKED' });
    expect(selfAction.status).toBe(403);

    const blocked = await request(app)
      .patch(`/api/admin/users/${staffId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'BLOCKED' });
    expect(blocked.status).toBe(200);
    expect(blocked.body.status).toBe('BLOCKED');

    const loginBlocked = await request(app)
      .post('/api/auth/login')
      .send({ email: STAFF_EMAIL, password: PASSWORD });
    expect(loginBlocked.status).toBe(403);
    expect(loginBlocked.body).toEqual({ message: 'Аккаунт заблокирован администратором' });

    const unblocked = await request(app)
      .patch(`/api/admin/users/${staffId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' });
    expect(unblocked.status).toBe(200);

    const loginRestored = await loginUser(STAFF_EMAIL);
    expect(loginRestored).toEqual(expect.any(String));

    const demoted = await request(app)
      .patch(`/api/admin/users/${staffId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ globalRole: 'USER' });
    expect(demoted.status).toBe(200);
    expect(demoted.body.globalRole).toBe('USER');
  }, 20000);
});
