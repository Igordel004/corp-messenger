import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma, disconnectDatabase } from '../data-access/prisma';
import { signAccessToken } from '../services/auth';

const RUN_ID = Date.now();
const USER_ID = `feeduser-${RUN_ID}`;
const OTHER_ID = `feedguest-${RUN_ID}`;

const createTestUser = async (): Promise<void> => {
  await prisma.user.create({
    data: {
      id: USER_ID,
      fullName: 'Тестовый Создатель',
      email: `feedcreator-${RUN_ID}@corp.messenger.com`,
      passwordHash: 'test-hash',
      globalRole: 'USER',
      status: 'ACTIVE',
    },
  });
};

const createSecondUser = async (): Promise<void> => {
  await prisma.user.create({
    data: {
      id: OTHER_ID,
      fullName: 'Второй Участник',
      email: `feedguest-${RUN_ID}@corp.messenger.com`,
      passwordHash: 'test-hash',
      globalRole: 'USER',
      status: 'ACTIVE',
    },
  });
};

const cleanupMessages = async (): Promise<void> => {
  await prisma.channel.deleteMany({
    where: { name: { startsWith: 'messages-' } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_ID] } } });
};

const authToken = (): string => signAccessToken({ sub: USER_ID, role: 'USER' });
const otherAuth = (): string => signAccessToken({ sub: OTHER_ID, role: 'USER' });

const createChannel = async (name: string, type = 'PUBLIC'): Promise<string> => {
  const created = await request(app)
    .post('/api/channels')
    .set('Authorization', `Bearer ${authToken()}`)
    .send({ name, type });
  return created.body.id as string;
};

describe('Integration Test: GET /api/channels/:id/messages (PostgreSQL)', () => {
  beforeAll(async () => {
    await cleanupMessages();
    await createTestUser();
    await createSecondUser();
  });

  afterAll(async () => {
    await cleanupMessages();
    await disconnectDatabase();
  });

  it('возвращает сообщения в хронологическом порядке с именем автора и временем', async () => {
    const channelId = await createChannel(`messages-feed-${RUN_ID}`);
    const first = new Date('2026-10-24T12:40:00.000Z');
    const second = new Date('2026-10-24T12:41:00.000Z');

    await prisma.message.create({
      data: { content: 'Второе сообщение', authorId: USER_ID, channelId, createdAt: second },
    });
    await prisma.message.create({
      data: { content: 'Первое сообщение', authorId: USER_ID, channelId, createdAt: first },
    });

    const response = await request(app)
      .get(`/api/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({
      content: 'Первое сообщение',
      authorId: USER_ID,
      authorName: 'Тестовый Создатель',
      createdAt: first.toISOString(),
    });
    expect(response.body[1]).toMatchObject({
      content: 'Второе сообщение',
      createdAt: second.toISOString(),
    });
  });

  it('возвращает пустую ленту для канала без сообщений', async () => {
    const channelId = await createChannel(`messages-empty-${RUN_ID}`);

    const response = await request(app)
      .get(`/api/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('лента недоступна постороннему пользователю (403)', async () => {
    const created = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${otherAuth()}`)
      .send({ name: `messages-private-${RUN_ID}`, type: 'PRIVATE' });

    const response = await request(app)
      .get(`/api/channels/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(403);
  });

  it('несуществующий канал возвращает 404', async () => {
    const response = await request(app)
      .get('/api/channels/00000000-0000-4000-8000-000000000000/messages')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(404);
  });

  it('возвращает 401 без токена', async () => {
    const response = await request(app).get(
      '/api/channels/00000000-0000-4000-8000-000000000000/messages',
    );

    expect(response.status).toBe(401);
  });
});
