import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { type Server } from 'http';
import { type AddressInfo } from 'net';
import WebSocket from 'ws';
import { app, createHttpServer } from '../app';
import { prisma, disconnectDatabase } from '../data-access/prisma';
import { MAX_MESSAGE_LENGTH } from '../services/message';

const RUN_ID = Date.now();
const PASSWORD = 'secretPass123';
const OWNER_EMAIL = `stressowner-${RUN_ID}@corp.messenger.com`;
const CHANNEL_NAME = `Стресс-${RUN_ID}`;
const CLIENT_COUNT = 50;

let httpServer: Server;
let wsPort: number;
let channelId: string;
let accessToken: string;

const cleanup = async (): Promise<void> => {
  await prisma.channel.deleteMany({ where: { name: CHANNEL_NAME } });
  await prisma.user.deleteMany({ where: { email: OWNER_EMAIL } });
};

const openSocket = (token: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${wsPort}/ws?token=${token}`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });

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

const subscribe = async (socket: WebSocket): Promise<void> => {
  socket.send(JSON.stringify({ type: 'subscribe', channelId }));
  await nextFrame(socket, 'subscribed');
};

describe('Сценарий: нагрузка на WebSocket-шлюз', () => {
  beforeAll(async () => {
    await cleanup();
    httpServer = createHttpServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    wsPort = (httpServer.address() as AddressInfo).port;

    await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Нагрузочный Тест', email: OWNER_EMAIL, password: PASSWORD });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: OWNER_EMAIL, password: PASSWORD });
    accessToken = login.body.accessToken as string;

    const created = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: CHANNEL_NAME, type: 'PUBLIC' });
    channelId = created.body.id as string;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await cleanup();
    await disconnectDatabase();
  });

  it(`${CLIENT_COUNT} клиентов получают одно сообщение одновременно`, async () => {
    const sockets = await Promise.all(
      Array.from({ length: CLIENT_COUNT }, () => openSocket(accessToken)),
    );
    await Promise.all(sockets.map((socket) => subscribe(socket)));

    const deliveries = sockets.map((socket) => nextFrame(socket, 'message'));
    sockets[0].send(JSON.stringify({ type: 'send', channelId, content: 'Сводка спринта' }));

    const frames = await Promise.all(deliveries);
    for (const frame of frames) {
      expect(frame.message).toMatchObject({ content: 'Сводка спринта' });
    }

    sockets.forEach((socket) => socket.close());
  }, 30000);

  it('клиент переподключается и продолжает получать сообщения', async () => {
    const first = await openSocket(accessToken);
    await subscribe(first);
    first.close();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });

    const second = await openSocket(accessToken);
    await subscribe(second);

    const delivered = nextFrame(second, 'message');
    const helper = await openSocket(accessToken);
    await subscribe(helper);
    helper.send(JSON.stringify({ type: 'send', channelId, content: 'После переподключения' }));

    expect(await delivered).toMatchObject({
      message: { content: 'После переподключения' },
    });

    helper.close();
    second.close();
  }, 20000);

  it('сообщение максимальной длины доставляется, превышение отклоняется', async () => {
    const socket = await openSocket(accessToken);
    await subscribe(socket);

    const delivered = nextFrame(socket, 'message');
    socket.send(
      JSON.stringify({ type: 'send', channelId, content: 'а'.repeat(MAX_MESSAGE_LENGTH) }),
    );
    expect(await delivered).toMatchObject({
      message: { content: 'а'.repeat(MAX_MESSAGE_LENGTH) },
    });

    const rejected = nextFrame(socket, 'error');
    socket.send(
      JSON.stringify({ type: 'send', channelId, content: 'б'.repeat(MAX_MESSAGE_LENGTH + 1) }),
    );
    expect(await rejected).toEqual({
      type: 'error',
      message: `Сообщение не может быть пустым или длиннее ${MAX_MESSAGE_LENGTH} символов`,
    });

    socket.close();
  }, 20000);

  it('отправка в канал без активных подписчиков не теряет запись', async () => {
    const helper = await openSocket(accessToken);
    await subscribe(helper);
    const delivered = nextFrame(helper, 'message');
    helper.send(JSON.stringify({ type: 'send', channelId, content: 'Одиночная запись' }));
    await delivered;
    helper.close();

    const feed = await request(app)
      .get(`/api/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(feed.body.some((m: { content: string }) => m.content === 'Одиночная запись')).toBe(true);
  }, 20000);
});
