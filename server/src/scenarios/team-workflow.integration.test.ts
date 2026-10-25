import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { type Server } from 'http';
import { type AddressInfo } from 'net';
import WebSocket from 'ws';
import { app, createHttpServer } from '../app';
import { prisma, disconnectDatabase } from '../data-access/prisma';

const RUN_ID = Date.now();
const PASSWORD = 'secretPass123';

const OWNER_EMAIL = `lead-${RUN_ID}@corp.messenger.com`;
const MENTEE_EMAIL = `junior-${RUN_ID}@corp.messenger.com`;
const COLLEAGUE_EMAIL = `colleague-${RUN_ID}@corp.messenger.com`;
const CHANNEL_NAME = `Спринт-${RUN_ID}`;

let httpServer: Server;
let wsPort: number;

const cleanup = async (): Promise<void> => {
  await prisma.channel.deleteMany({ where: { name: CHANNEL_NAME } });
  await prisma.user.deleteMany({
    where: { email: { in: [OWNER_EMAIL, MENTEE_EMAIL, COLLEAGUE_EMAIL] } },
  });
};

const registerUser = async (fullName: string, email: string): Promise<string> => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ fullName, email, password: PASSWORD });
  expect(response.status).toBe(201);
  return response.body.id as string;
};

const loginUser = async (email: string): Promise<string> => {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return response.body.accessToken as string;
};

const openSocket = async (token: string): Promise<WebSocket> => {
  const socket = new WebSocket(`ws://127.0.0.1:${wsPort}/ws?token=${token}`);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return socket;
};

const nextFrame = (socket: WebSocket, type: string): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    const handler = (data: WebSocket.RawData): void => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type === type) {
        socket.off('message', handler);
        resolve(frame);
      }
    };
    socket.on('message', handler);
  });

describe('Сценарий: команда создаёт канал и работает вместе', () => {
  beforeAll(async () => {
    await cleanup();
    httpServer = createHttpServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    wsPort = (httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await cleanup();
    await disconnectDatabase();
  });

  it('руководитель собирает команду, сотрудники обмениваются сообщениями', async () => {
    await registerUser('Иван Руководитель', OWNER_EMAIL);
    const ownerToken = await loginUser(OWNER_EMAIL);
    const menteeId = await registerUser('Пётр Стажёр', MENTEE_EMAIL);
    const menteeToken = await loginUser(MENTEE_EMAIL);
    const colleagueId = await registerUser('Анна Коллега', COLLEAGUE_EMAIL);
    const colleagueToken = await loginUser(COLLEAGUE_EMAIL);

    const created = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: CHANNEL_NAME, type: 'PUBLIC' });
    expect(created.status).toBe(201);
    const channelId = created.body.id as string;

    const catalog = await request(app)
      .get('/api/channels/catalog')
      .set('Authorization', `Bearer ${menteeToken}`);
    expect(catalog.body.map((channel: { id: string }) => channel.id)).toContain(channelId);

    const joined = await request(app)
      .post(`/api/channels/${channelId}/join`)
      .set('Authorization', `Bearer ${menteeToken}`);
    expect(joined.status).toBe(201);

    const added = await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: COLLEAGUE_EMAIL });
    expect(added.status).toBe(201);

    const promoted = await request(app)
      .patch(`/api/channels/${channelId}/members/${menteeId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'MODERATOR' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.role).toBe('MODERATOR');

    const menteeSocket = await openSocket(menteeToken);
    const colleagueSocket = await openSocket(colleagueToken);
    menteeSocket.send(JSON.stringify({ type: 'subscribe', channelId }));
    colleagueSocket.send(JSON.stringify({ type: 'subscribe', channelId }));
    await Promise.all([
      nextFrame(menteeSocket, 'subscribed'),
      nextFrame(colleagueSocket, 'subscribed'),
    ]);

    const delivered = nextFrame(colleagueSocket, 'message');
    menteeSocket.send(
      JSON.stringify({ type: 'send', channelId, content: 'Готов брать задачи спринта' }),
    );
    const received = await delivered;
    expect(received.message).toMatchObject({
      content: 'Готов брать задачи спринта',
      authorName: 'Пётр Стажёр',
    });

    const feed = await request(app)
      .get(`/api/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(feed.status).toBe(200);
    expect(feed.body).toHaveLength(1);
    expect(feed.body[0]).toMatchObject({
      content: 'Готов брать задачи спринта',
      authorName: 'Пётр Стажёр',
      createdAt: expect.any(String),
    });

    const messageId = feed.body[0].id as string;
    const deleted = nextFrame(colleagueSocket, 'message.deleted');
    menteeSocket.send(JSON.stringify({ type: 'delete', messageId }));
    await deleted;

    const feedAfterDeletion = await request(app)
      .get(`/api/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(feedAfterDeletion.body).toHaveLength(0);

    const removed = await request(app)
      .delete(`/api/channels/${channelId}/members/${colleagueId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(removed.status).toBe(200);

    const membersAfterRemoval = await request(app)
      .get(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${colleagueToken}`);
    expect(membersAfterRemoval.status).toBe(403);

    menteeSocket.close();
    colleagueSocket.close();
  }, 20000);
});
