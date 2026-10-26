import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { type Server } from 'http';
import { type AddressInfo } from 'net';
import WebSocket from 'ws';
import { app, createHttpServer } from '../app';
import { prisma, disconnectDatabase } from '../data-access/prisma';

const RUN_ID = Date.now();
const PASSWORD = 'secretPass123';

const OWNER_EMAIL = `rbowner-${RUN_ID}@corp.messenger.com`;
const MOD_EMAIL = `rbmod-${RUN_ID}@corp.messenger.com`;
const MEMBER_EMAIL = `rbmember-${RUN_ID}@corp.messenger.com`;
const STRANGER_EMAIL = `rbstranger-${RUN_ID}@corp.messenger.com`;
const ADMIN_EMAIL = `rbadmin-${RUN_ID}@corp.messenger.com`;
const CHANNEL_NAME = `Матрица-${RUN_ID}`;

let httpServer: Server;
let wsPort: number;
let channelId: string;
let ownerToken = '';
let modToken = '';
let memberToken = '';
let strangerToken = '';
let adminToken = '';
let ownerId = '';
let modId = '';
let memberId = '';
let strangerId = '';

const cleanup = async (): Promise<void> => {
  await prisma.channel.deleteMany({ where: { name: { in: [CHANNEL_NAME, 'abc'] } } });
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          OWNER_EMAIL,
          MOD_EMAIL,
          MEMBER_EMAIL,
          STRANGER_EMAIL,
          ADMIN_EMAIL,
          `edge-pass-${RUN_ID}@corp.messenger.com`,
          `edge-block-${RUN_ID}@corp.messenger.com`,
        ],
      },
    },
  });
};

const registerAndLogin = async (
  fullName: string,
  email: string,
): Promise<{ id: string; token: string }> => {
  const registered = await request(app)
    .post('/api/auth/register')
    .send({ fullName, email, password: PASSWORD });
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return { id: registered.body.id as string, token: login.body.accessToken as string };
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

describe('Матрица RBAC: роли канала', () => {
  beforeAll(async () => {
    await cleanup();
    httpServer = createHttpServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    wsPort = (httpServer.address() as AddressInfo).port;

    ({ id: ownerId, token: ownerToken } = await registerAndLogin('Владелец Тест', OWNER_EMAIL));
    ({ id: modId, token: modToken } = await registerAndLogin('Модератор Тест', MOD_EMAIL));
    ({ id: memberId, token: memberToken } = await registerAndLogin('Участник Тест', MEMBER_EMAIL));
    ({ token: strangerToken, id: strangerId } = await registerAndLogin(
      'Посторонний Тест',
      STRANGER_EMAIL,
    ));
    ({ token: adminToken } = await registerAndLogin('Админ Тест', ADMIN_EMAIL));
    await prisma.user.update({ where: { email: ADMIN_EMAIL }, data: { globalRole: 'ADMIN' } });

    const created = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: CHANNEL_NAME, type: 'PUBLIC' });
    channelId = created.body.id as string;

    await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: MOD_EMAIL });
    await request(app)
      .patch(`/api/channels/${channelId}/members/${modId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'MODERATOR' });
    await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: MEMBER_EMAIL });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await cleanup();
    await disconnectDatabase();
  });

  it('MEMBER не удаляет чужое сообщение, MODERATOR и OWNER — удаляют', async () => {
    const memberSocket = await openSocket(memberToken);
    const modSocket = await openSocket(modToken);
    const ownerSocket = await openSocket(ownerToken);
    for (const socket of [memberSocket, modSocket, ownerSocket]) {
      socket.send(JSON.stringify({ type: 'subscribe', channelId }));
      await nextFrame(socket, 'subscribed');
    }

    const firstDelivery = nextFrame(modSocket, 'message');
    memberSocket.send(JSON.stringify({ type: 'send', channelId, content: 'Первое' }));
    const first = (await firstDelivery).message as { id: string };

    const secondDelivery = nextFrame(modSocket, 'message');
    modSocket.send(JSON.stringify({ type: 'send', channelId, content: 'Второе' }));
    const second = (await secondDelivery).message as { id: string };

    const denied = nextFrame(memberSocket, 'error');
    memberSocket.send(JSON.stringify({ type: 'delete', messageId: second.id }));
    expect(await denied).toEqual({
      type: 'error',
      message: 'Удалять сообщения может только автор, модератор или владелец',
    });

    const deletedByMod = nextFrame(ownerSocket, 'message.deleted');
    modSocket.send(JSON.stringify({ type: 'delete', messageId: first.id }));
    expect(await deletedByMod).toMatchObject({ messageId: first.id });

    const deletedByOwner = nextFrame(modSocket, 'message.deleted');
    ownerSocket.send(JSON.stringify({ type: 'delete', messageId: second.id }));
    expect(await deletedByOwner).toMatchObject({ messageId: second.id });

    memberSocket.close();
    modSocket.close();
    ownerSocket.close();
  }, 20000);

  it('MEMBER удаляет только своё сообщение', async () => {
    const memberSocket = await openSocket(memberToken);
    memberSocket.send(JSON.stringify({ type: 'subscribe', channelId }));
    await nextFrame(memberSocket, 'subscribed');

    const delivered = nextFrame(memberSocket, 'message');
    memberSocket.send(JSON.stringify({ type: 'send', channelId, content: 'Своё сообщение' }));
    const own = (await delivered).message as { id: string };

    const deleted = nextFrame(memberSocket, 'message.deleted');
    memberSocket.send(JSON.stringify({ type: 'delete', messageId: own.id }));
    expect(await deleted).toMatchObject({ messageId: own.id });

    memberSocket.close();
  }, 20000);

  it('добавлять участников могут только OWNER и MODERATOR', async () => {
    const forbidden = await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ email: STRANGER_EMAIL });
    expect(forbidden.status).toBe(403);

    const allowed = await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${modToken}`)
      .send({ email: STRANGER_EMAIL });
    expect(allowed.status).toBe(201);
  }, 20000);

  it('исключать участников может только OWNER', async () => {
    const byMod = await request(app)
      .delete(`/api/channels/${channelId}/members/${strangerId}`)
      .set('Authorization', `Bearer ${modToken}`);
    expect(byMod.status).toBe(403);

    const byOwner = await request(app)
      .delete(`/api/channels/${channelId}/members/${strangerId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(byOwner.status).toBe(200);
  }, 20000);

  it('менять роли может только OWNER, роль OWNER неизменяема', async () => {
    const byMod = await request(app)
      .patch(`/api/channels/${channelId}/members/${memberId}/role`)
      .set('Authorization', `Bearer ${modToken}`)
      .send({ role: 'MODERATOR' });
    expect(byMod.status).toBe(403);

    const ownerRole = await request(app)
      .patch(`/api/channels/${channelId}/members/${ownerId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'MEMBER' });
    expect(ownerRole.status).toBe(400);

    const upgraded = await request(app)
      .patch(`/api/channels/${channelId}/members/${memberId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'MODERATOR' });
    expect(upgraded.status).toBe(200);
    expect(upgraded.body.role).toBe('MODERATOR');
  }, 20000);

  it('посторонний не читает состав и ленту канала', async () => {
    const members = await request(app)
      .get(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(members.status).toBe(403);

    const feed = await request(app)
      .get(`/api/channels/${channelId}/messages`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(feed.status).toBe(403);
  }, 20000);

  it('админ-эндпоинты закрыты для USER и открыты для ADMIN', async () => {
    const asUser = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(asUser.status).toBe(403);

    const asAdmin = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(asAdmin.status).toBe(200);
  }, 20000);
});

describe('Матрица RBAC: краевые условия', () => {
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

  it('границы валидации: пароль 7 символов отклонён, 8 принят', async () => {
    const shortPassword = await request(app)
      .post('/api/auth/register')
      .send({
        fullName: 'Граница Пароль',
        email: `edge-pass-${RUN_ID}@corp.messenger.com`,
        password: 'a'.repeat(7),
      });
    expect(shortPassword.status).toBe(400);

    const okPassword = await request(app)
      .post('/api/auth/register')
      .send({
        fullName: 'Граница Пароль',
        email: `edge-pass-${RUN_ID}@corp.messenger.com`,
        password: 'a'.repeat(8),
      });
    expect(okPassword.status).toBe(201);
  }, 20000);

  it('границы валидации: название канала 2 символа отклонено, 3 принято', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: `edge-pass-${RUN_ID}@corp.messenger.com`, password: 'a'.repeat(8) });
    const token = login.body.accessToken as string;

    const shortName = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ab', type: 'PUBLIC' });
    expect(shortName.status).toBe(400);

    const okName = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'abc', type: 'PUBLIC' });
    expect(okName.status).toBe(201);
  }, 20000);

  it('заблокированный аккаунт не проходит аутентификацию', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        fullName: 'Заблокированный',
        email: `edge-block-${RUN_ID}@corp.messenger.com`,
        password: 'a'.repeat(8),
      });
    const created = await prisma.user.findUnique({
      where: { email: `edge-block-${RUN_ID}@corp.messenger.com` },
    });
    await prisma.user.update({ where: { id: created!.id }, data: { status: 'BLOCKED' } });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: `edge-block-${RUN_ID}@corp.messenger.com`, password: 'a'.repeat(8) });
    expect(login.status).toBe(403);
  }, 20000);

  it('несуществующие сущности возвращают 404', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: `edge-pass-${RUN_ID}@corp.messenger.com`, password: 'a'.repeat(8) });
    const token = login.body.accessToken as string;
    const ghost = '00000000-0000-4000-8000-000000000000';

    const feed = await request(app)
      .get(`/api/channels/${ghost}/messages`)
      .set('Authorization', `Bearer ${token}`);
    expect(feed.status).toBe(404);

    const roleChange = await request(app)
      .patch(`/api/channels/${ghost}/members/${ghost}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'MEMBER' });
    expect(roleChange.status).toBe(404);

    const statusChange = await request(app)
      .patch(`/api/admin/users/${ghost}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'BLOCKED' });
    expect(statusChange.status).toBe(403);
  }, 20000);
});
