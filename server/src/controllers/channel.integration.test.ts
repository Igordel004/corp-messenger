import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma, disconnectDatabase } from '../data-access/prisma';
import { signAccessToken } from '../services/auth';

const RUN_ID = Date.now();
const USER_ID = `user-${RUN_ID}`;

const cleanup = async (): Promise<void> => {
  await prisma.channel.deleteMany({ where: { name: { startsWith: 'test-channel' } } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
};

const createTestUser = async (): Promise<void> => {
  await prisma.user.create({
    data: {
      id: USER_ID,
      fullName: 'Тестовый Создатель',
      email: `creator-${RUN_ID}@corp.messenger.com`,
      passwordHash: 'test-hash',
      globalRole: 'USER',
      status: 'ACTIVE',
    },
  });
};

const authToken = (): string => signAccessToken({ sub: USER_ID, role: 'USER' });

describe('Integration Test: POST /api/channels (реальная БД)', () => {
  beforeAll(async () => {
    await cleanup();
    await createTestUser();
  });

  afterAll(async () => {
    await cleanup();
    await disconnectDatabase();
  });

  it('создаёт публичный канал и возвращает 201 с ролью OWNER', async () => {
    const response = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: `test-channel-public-${RUN_ID}`, type: 'PUBLIC' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: `test-channel-public-${RUN_ID}`,
      type: 'PUBLIC',
      role: 'OWNER',
    });

    const channel = await prisma.channel.findUnique({ where: { id: response.body.id } });
    expect(channel).not.toBeNull();
    expect(channel?.name).toBe(`test-channel-public-${RUN_ID}`);

    const member = await prisma.channelMember.findFirst({
      where: { channelId: response.body.id, userId: USER_ID },
    });
    expect(member?.role).toBe('OWNER');
  });

  it('создаёт приватный канал с корректным типом', async () => {
    const response = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: `test-channel-private-${RUN_ID}`, type: 'PRIVATE' });

    expect(response.status).toBe(201);
    expect(response.body.type).toBe('PRIVATE');
  });

  it('обрезает пробелы по краям названия', async () => {
    const response = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: `  test-channel-trim-${RUN_ID}  `, type: 'PUBLIC' });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe(`test-channel-trim-${RUN_ID}`);
  });

  it('отклоняет название короче 3 символов с кодом 400', async () => {
    const response = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 'ab', type: 'PUBLIC' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('не менее 3 символов');

    const count = await prisma.channel.count({ where: { name: 'ab' } });
    expect(count).toBe(0);
  });

  it('отклоняет неизвестный тип канала с кодом 400', async () => {
    const response = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: `test-channel-badtype-${RUN_ID}`, type: 'SECRET' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('PUBLIC или PRIVATE');
  });

  it('отклоняет запрос без токена с кодом 401', async () => {
    const response = await request(app)
      .post('/api/channels')
      .send({ name: `test-channel-anon-${RUN_ID}`, type: 'PUBLIC' });

    expect(response.status).toBe(401);

    const count = await prisma.channel.count({
      where: { name: `test-channel-anon-${RUN_ID}` },
    });
    expect(count).toBe(0);
  });

  it('отклоняет запрос с пустым телом с кодом 400', async () => {
    const response = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('не менее 3 символов');
  });

  it('отклоняет запрос с не-объектным телом с кодом 400', async () => {
    const response = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('Content-Type', 'text/plain')
      .send('plain-string-body');

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('название и тип канала');
  });

  it('отклоняет нестроковое название с кодом 400', async () => {
    const response = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: 12345, type: 'PUBLIC' });

    expect(response.status).toBe(400);
  });
});

describe('Integration Test: GET /api/channels (реальная БД)', () => {
  beforeAll(async () => {
    await cleanup();
    await createTestUser();
  });

  afterAll(async () => {
    await cleanup();
    await disconnectDatabase();
  });

  it('возвращает каналы пользователя с ролью и типом', async () => {
    await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: `test-channel-list-${RUN_ID}`, type: 'PRIVATE' });

    const response = await request(app)
      .get('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);

    const created = response.body.find(
      (channel: { name: string }) => channel.name === `test-channel-list-${RUN_ID}`,
    );
    expect(created).toMatchObject({
      id: expect.any(String),
      type: 'PRIVATE',
      role: 'OWNER',
      joinedAt: expect.any(String),
    });
  });

  it('возвращает 401 без токена', async () => {
    const response = await request(app).get('/api/channels');
    expect(response.status).toBe(401);
  });
});

describe('Integration Test: GET /api/channels/catalog (реальная БД)', () => {
  const OTHER_ID = `other-${RUN_ID}`;

  const createSecondUser = async (): Promise<void> => {
    await prisma.user.create({
      data: {
        id: OTHER_ID,
        fullName: 'Второй Пользователь',
        email: `second-${RUN_ID}@corp.messenger.com`,
        passwordHash: 'test-hash',
        globalRole: 'USER',
        status: 'ACTIVE',
      },
    });
  };

  const cleanupCatalog = async (): Promise<void> => {
    await prisma.channel.deleteMany({
      where: { name: { startsWith: 'catalog-' } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_ID] } } });
  };

  beforeAll(async () => {
    await cleanupCatalog();
    await createTestUser();
    await createSecondUser();
  });

  afterAll(async () => {
    await cleanupCatalog();
    await disconnectDatabase();
  });

  it('показывает публичный канал всем, а приватный — только участнику', async () => {
    const publicChannel = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${signAccessToken({ sub: OTHER_ID, role: 'USER' })}`)
      .send({ name: `catalog-public-${RUN_ID}`, type: 'PUBLIC' });

    const privateChannel = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${signAccessToken({ sub: OTHER_ID, role: 'USER' })}`)
      .send({ name: `catalog-private-${RUN_ID}`, type: 'PRIVATE' });

    const response = await request(app)
      .get('/api/channels/catalog')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(200);

    const names = response.body.map((channel: { name: string }) => channel.name);
    expect(names).toContain(`catalog-public-${RUN_ID}`);
    expect(names).not.toContain(`catalog-private-${RUN_ID}`);

    const publicEntry = response.body.find(
      (channel: { name: string }) => channel.name === `catalog-public-${RUN_ID}`,
    );
    expect(publicEntry.isMember).toBe(false);
    expect(publicEntry.type).toBe('PUBLIC');
    expect(publicChannel.status).toBe(201);
    expect(privateChannel.status).toBe(201);
  });

  it('отмечает канал пользователя как участник', async () => {
    await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: `catalog-own-${RUN_ID}`, type: 'PRIVATE' });

    const response = await request(app)
      .get('/api/channels/catalog')
      .set('Authorization', `Bearer ${authToken()}`);

    const own = response.body.find(
      (channel: { name: string }) => channel.name === `catalog-own-${RUN_ID}`,
    );
    expect(own).toMatchObject({ type: 'PRIVATE', isMember: true });
  });

  it('возвращает 401 без токена', async () => {
    const response = await request(app).get('/api/channels/catalog');
    expect(response.status).toBe(401);
  });
});

describe('Integration Test: POST /api/channels/:id/join (реальная БД)', () => {
  const OTHER_ID = `joiner-${RUN_ID}`;

  const createSecondUser = async (): Promise<void> => {
    await prisma.user.create({
      data: {
        id: OTHER_ID,
        fullName: 'Второй Пользователь',
        email: `join-second-${RUN_ID}@corp.messenger.com`,
        passwordHash: 'test-hash',
        globalRole: 'USER',
        status: 'ACTIVE',
      },
    });
  };

  const otherAuth = (): string => signAccessToken({ sub: OTHER_ID, role: 'USER' });

  const cleanupJoin = async (): Promise<void> => {
    await prisma.channel.deleteMany({
      where: { name: { startsWith: 'join-' } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_ID] } } });
  };

  beforeAll(async () => {
    await cleanupJoin();
    await createTestUser();
    await createSecondUser();
  });

  afterAll(async () => {
    await cleanupJoin();
    await disconnectDatabase();
  });

  const createOtherChannel = async (name: string, type: string): Promise<string> => {
    const response = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${otherAuth()}`)
      .send({ name, type });
    return response.body.id as string;
  };

  it('вступление в публичный канал добавляет участника с ролью MEMBER', async () => {
    const channelId = await createOtherChannel(`join-public-${RUN_ID}`, 'PUBLIC');

    const response = await request(app)
      .post(`/api/channels/${channelId}/join`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: channelId,
      name: `join-public-${RUN_ID}`,
      type: 'PUBLIC',
      role: 'MEMBER',
    });

    const member = await prisma.channelMember.findFirst({
      where: { channelId, userId: USER_ID },
    });
    expect(member?.role).toBe('MEMBER');

    const catalog = await request(app)
      .get('/api/channels/catalog')
      .set('Authorization', `Bearer ${authToken()}`);
    const entry = catalog.body.find((channel: { id: string }) => channel.id === channelId);
    expect(entry.isMember).toBe(true);
  });

  it('повторное вступление отклоняется с кодом 409', async () => {
    const channelId = await createOtherChannel(`join-repeat-${RUN_ID}`, 'PUBLIC');

    await request(app)
      .post(`/api/channels/${channelId}/join`)
      .set('Authorization', `Bearer ${authToken()}`);

    const repeat = await request(app)
      .post(`/api/channels/${channelId}/join`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(repeat.status).toBe(409);

    const count = await prisma.channelMember.count({
      where: { channelId, userId: USER_ID },
    });
    expect(count).toBe(1);
  });

  it('вступление в чужой приватный канал отклоняется с кодом 400', async () => {
    const channelId = await createOtherChannel(`join-private-${RUN_ID}`, 'PRIVATE');

    const response = await request(app)
      .post(`/api/channels/${channelId}/join`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('публичный');

    const count = await prisma.channelMember.count({
      where: { channelId, userId: USER_ID },
    });
    expect(count).toBe(0);
  });

  it('несуществующий канал возвращает 404', async () => {
    const response = await request(app)
      .post('/api/channels/00000000-0000-4000-8000-000000000000/join')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('не найден');
  });

  it('возвращает 401 без токена', async () => {
    const channelId = await createOtherChannel(`join-anon-${RUN_ID}`, 'PUBLIC');

    const response = await request(app).post(`/api/channels/${channelId}/join`);

    expect(response.status).toBe(401);
  });
});

describe('Integration Test: GET /api/channels/:id/members (реальная БД)', () => {
  const OTHER_ID = `mlist-${RUN_ID}`;

  const createSecondUser = async (): Promise<void> => {
    await prisma.user.create({
      data: {
        id: OTHER_ID,
        fullName: 'Второй Участник',
        email: `mlist-second-${RUN_ID}@corp.messenger.com`,
        passwordHash: 'test-hash',
        globalRole: 'USER',
        status: 'ACTIVE',
      },
    });
  };

  const cleanupMembers = async (): Promise<void> => {
    await prisma.channel.deleteMany({
      where: { name: { startsWith: 'members-' } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_ID] } } });
  };

  const otherAuth = (): string => signAccessToken({ sub: OTHER_ID, role: 'USER' });

  beforeAll(async () => {
    await cleanupMembers();
    await createTestUser();
    await createSecondUser();
  });

  afterAll(async () => {
    await cleanupMembers();
    await disconnectDatabase();
  });

  it('участник видит список участников с локальными ролями', async () => {
    const created = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: `members-public-${RUN_ID}`, type: 'PUBLIC' });
    const channelId = created.body.id as string;

    await request(app)
      .post(`/api/channels/${channelId}/join`)
      .set('Authorization', `Bearer ${otherAuth()}`);

    const response = await request(app)
      .get(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);

    const owner = response.body.find((member: { userId: string }) => member.userId === USER_ID);
    expect(owner).toMatchObject({
      fullName: 'Тестовый Создатель',
      email: `creator-${RUN_ID}@corp.messenger.com`,
      role: 'OWNER',
    });

    const joiner = response.body.find((member: { userId: string }) => member.userId === OTHER_ID);
    expect(joiner).toMatchObject({ role: 'MEMBER' });
    expect(joiner.joinedAt).toEqual(expect.any(String));
  });

  it('список недоступен постороннему пользователю (403)', async () => {
    const created = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${otherAuth()}`)
      .send({ name: `members-private-${RUN_ID}`, type: 'PRIVATE' });

    const response = await request(app)
      .get(`/api/channels/${created.body.id}/members`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(403);
  });

  it('несуществующий канал возвращает 404', async () => {
    const response = await request(app)
      .get('/api/channels/00000000-0000-4000-8000-000000000000/members')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(404);
  });

  it('возвращает 401 без токена', async () => {
    const response = await request(app).get(
      '/api/channels/00000000-0000-4000-8000-000000000000/members',
    );

    expect(response.status).toBe(401);
  });
});

describe('Integration Test: POST /api/channels/:id/members (реальная БД)', () => {
  const INVITEE_ID = `invitee-${RUN_ID}`;
  const MEMBER_ID = `plain-${RUN_ID}`;

  const createSupportUsers = async (): Promise<void> => {
    await prisma.user.createMany({
      data: [
        {
          id: INVITEE_ID,
          fullName: 'Приглашённый Сотрудник',
          email: `invitee-${RUN_ID}@corp.messenger.com`,
          passwordHash: 'test-hash',
          globalRole: 'USER',
          status: 'ACTIVE',
        },
        {
          id: MEMBER_ID,
          fullName: 'Рядовой Участник',
          email: `plain-${RUN_ID}@corp.messenger.com`,
          passwordHash: 'test-hash',
          globalRole: 'USER',
          status: 'ACTIVE',
        },
      ],
    });
  };

  const cleanupAdd = async (): Promise<void> => {
    await prisma.channel.deleteMany({ where: { name: { startsWith: 'add-' } } });
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ID, INVITEE_ID, MEMBER_ID] } },
    });
  };

  const createOwnChannel = async (type = 'PRIVATE'): Promise<string> => {
    const response = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: `add-${type.toLowerCase()}-${RUN_ID}`, type });
    return response.body.id as string;
  };

  beforeAll(async () => {
    await cleanupAdd();
    await createTestUser();
    await createSupportUsers();
  });

  afterAll(async () => {
    await cleanupAdd();
    await disconnectDatabase();
  });

  it('владелец добавляет сотрудника по email с ролью MEMBER', async () => {
    const channelId = await createOwnChannel();

    const response = await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ email: `invitee-${RUN_ID}@corp.messenger.com` });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      userId: INVITEE_ID,
      fullName: 'Приглашённый Сотрудник',
      email: `invitee-${RUN_ID}@corp.messenger.com`,
      role: 'MEMBER',
    });

    const record = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: INVITEE_ID, channelId } },
    });
    expect(record?.role).toBe('MEMBER');

    const members = await request(app)
      .get(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`);
    expect(members.body).toHaveLength(2);
  });

  it('модератор может добавлять участников', async () => {
    const channelId = await createOwnChannel();

    await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ email: `plain-${RUN_ID}@corp.messenger.com` });
    await prisma.channelMember.update({
      where: { userId_channelId: { userId: MEMBER_ID, channelId } },
      data: { role: 'MODERATOR' },
    });

    const moderatorToken = signAccessToken({ sub: MEMBER_ID, role: 'USER' });
    const response = await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ email: `invitee-${RUN_ID}@corp.messenger.com` });

    expect(response.status).toBe(201);
  });

  it('рядовой участник не может добавлять (403)', async () => {
    const channelId = await createOwnChannel();

    await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ email: `plain-${RUN_ID}@corp.messenger.com` });

    const plainToken = signAccessToken({ sub: MEMBER_ID, role: 'USER' });
    const response = await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${plainToken}`)
      .send({ email: `invitee-${RUN_ID}@corp.messenger.com` });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('владелец или модератор');
  });

  it('несуществующий канал возвращает 404', async () => {
    const response = await request(app)
      .post('/api/channels/00000000-0000-4000-8000-000000000000/members')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ email: `invitee-${RUN_ID}@corp.messenger.com` });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Канал не найден');
  });

  it('неизвестный email возвращает 404', async () => {
    const channelId = await createOwnChannel();

    const response = await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ email: `ghost-${RUN_ID}@corp.messenger.com` });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('не найден');
  });

  it('повторное добавление возвращает 409', async () => {
    const channelId = await createOwnChannel();

    await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ email: `invitee-${RUN_ID}@corp.messenger.com` });

    const repeat = await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ email: `invitee-${RUN_ID}@corp.messenger.com` });

    expect(repeat.status).toBe(409);
  });

  it('отклоняет запрос без email с кодом 400', async () => {
    const channelId = await createOwnChannel();

    const response = await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('email');
  });

  it('отклоняет запрос вообще без тела с кодом 400', async () => {
    const channelId = await createOwnChannel();

    const response = await request(app)
      .post(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('email');
  });

  it('возвращает 401 без токена', async () => {
    const response = await request(app)
      .post('/api/channels/00000000-0000-4000-8000-000000000000/members')
      .send({ email: 'someone@corp.messenger.com' });

    expect(response.status).toBe(401);
  });
});

describe('Integration Test: DELETE /api/channels/:id/members/:userId (реальная БД)', () => {
  const MEMBER_ID = `victim-${RUN_ID}`;
  const MODERATOR_ID = `moder-${RUN_ID}`;

  const createSupportUsers = async (): Promise<void> => {
    await prisma.user.createMany({
      data: [
        {
          id: MEMBER_ID,
          fullName: 'Исключаемый Участник',
          email: `victim-${RUN_ID}@corp.messenger.com`,
          passwordHash: 'test-hash',
          globalRole: 'USER',
          status: 'ACTIVE',
        },
        {
          id: MODERATOR_ID,
          fullName: 'Модератор Канала',
          email: `moder-${RUN_ID}@corp.messenger.com`,
          passwordHash: 'test-hash',
          globalRole: 'USER',
          status: 'ACTIVE',
        },
      ],
    });
  };

  const cleanupRemove = async (): Promise<void> => {
    await prisma.channel.deleteMany({ where: { name: { startsWith: 'remove-' } } });
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ID, MEMBER_ID, MODERATOR_ID] } },
    });
  };

  const createChannelWithMember = async (
    memberRole: 'MEMBER' | 'MODERATOR',
    memberUserId: string,
  ): Promise<string> => {
    const created = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: `remove-${memberRole.toLowerCase()}-${RUN_ID}`, type: 'PRIVATE' });
    const channelId = created.body.id as string;

    await prisma.channelMember.create({
      data: { channelId, userId: memberUserId, role: memberRole },
    });
    return channelId;
  };

  beforeAll(async () => {
    await cleanupRemove();
    await createTestUser();
    await createSupportUsers();
  });

  afterAll(async () => {
    await cleanupRemove();
    await disconnectDatabase();
  });

  it('владелец исключает участника: запись удалена, доступ потерян', async () => {
    const channelId = await createChannelWithMember('MEMBER', MEMBER_ID);

    const response = await request(app)
      .delete(`/api/channels/${channelId}/members/${MEMBER_ID}`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(200);

    const record = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: MEMBER_ID, channelId } },
    });
    expect(record).toBeNull();

    const victimToken = signAccessToken({ sub: MEMBER_ID, role: 'USER' });
    const lost = await request(app)
      .get(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${victimToken}`);
    expect(lost.status).toBe(403);

    const members = await request(app)
      .get(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`);
    const ids = members.body.map((member: { userId: string }) => member.userId);
    expect(ids).not.toContain(MEMBER_ID);
  });

  it('модератор не может исключать участников (403)', async () => {
    const channelId = await createChannelWithMember('MODERATOR', MODERATOR_ID);
    await prisma.channelMember.create({
      data: { channelId, userId: MEMBER_ID, role: 'MEMBER' },
    });

    const moderatorToken = signAccessToken({ sub: MODERATOR_ID, role: 'USER' });
    const response = await request(app)
      .delete(`/api/channels/${channelId}/members/${MEMBER_ID}`)
      .set('Authorization', `Bearer ${moderatorToken}`);

    expect(response.status).toBe(403);

    const record = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: MEMBER_ID, channelId } },
    });
    expect(record).not.toBeNull();
  });

  it('владелец не может исключить самого себя (400)', async () => {
    const channelId = await createChannelWithMember('MEMBER', MEMBER_ID);

    const response = await request(app)
      .delete(`/api/channels/${channelId}/members/${USER_ID}`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Владелец');
  });

  it('исключение не-участника возвращает 404', async () => {
    const channelId = await createChannelWithMember('MEMBER', MEMBER_ID);

    const response = await request(app)
      .delete(`/api/channels/${channelId}/members/${MODERATOR_ID}`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(404);
  });

  it('несуществующий канал возвращает 404', async () => {
    const response = await request(app)
      .delete(`/api/channels/00000000-0000-4000-8000-000000000000/members/${MEMBER_ID}`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(404);
  });

  it('возвращает 401 без токена', async () => {
    const response = await request(app).delete(
      `/api/channels/00000000-0000-4000-8000-000000000000/members/${MEMBER_ID}`,
    );

    expect(response.status).toBe(401);
  });

  it('участник выходит из канала сам через каталог', async () => {
    const channelId = await createChannelWithMember('MEMBER', MEMBER_ID);
    const victimToken = signAccessToken({ sub: MEMBER_ID, role: 'USER' });

    const response = await request(app)
      .delete(`/api/channels/${channelId}/members/${MEMBER_ID}`)
      .set('Authorization', `Bearer ${victimToken}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toContain('вышли');

    const record = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: MEMBER_ID, channelId } },
    });
    expect(record).toBeNull();

    const lost = await request(app)
      .get(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${victimToken}`);
    expect(lost.status).toBe(403);

    const catalog = await request(app)
      .get('/api/channels/catalog')
      .set('Authorization', `Bearer ${victimToken}`)
      .send();
    const ids = catalog.body.map((channel: { id: string }) => channel.id);
    expect(ids).not.toContain(channelId);
  });

  it('владелец не может выйти из канала сам (400)', async () => {
    const channelId = await createChannelWithMember('MEMBER', MEMBER_ID);

    const response = await request(app)
      .delete(`/api/channels/${channelId}/members/${USER_ID}`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Владелец');

    const record = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: USER_ID, channelId } },
    });
    expect(record).not.toBeNull();
  });
});

describe('Integration Test: PATCH /api/channels/:id/members/:userId/role (реальная БД)', () => {
  const TARGET_ID = `target-${RUN_ID}`;
  const MODERATOR_ID = `moder-${RUN_ID}`;

  const createSupportUsers = async (): Promise<void> => {
    await prisma.user.createMany({
      data: [
        {
          id: TARGET_ID,
          fullName: 'Участник С Ролью',
          email: `target-${RUN_ID}@corp.messenger.com`,
          passwordHash: 'test-hash',
          globalRole: 'USER',
          status: 'ACTIVE',
        },
        {
          id: MODERATOR_ID,
          fullName: 'Модератор Ролей',
          email: `moder-role-${RUN_ID}@corp.messenger.com`,
          passwordHash: 'test-hash',
          globalRole: 'USER',
          status: 'ACTIVE',
        },
      ],
    });
  };

  const cleanupRoles = async (): Promise<void> => {
    await prisma.channel.deleteMany({ where: { name: { startsWith: 'roles-' } } });
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ID, TARGET_ID, MODERATOR_ID] } },
    });
  };

  const createChannelWithTarget = async (targetRole: 'MEMBER' | 'MODERATOR'): Promise<string> => {
    const created = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ name: `roles-${targetRole.toLowerCase()}-${RUN_ID}`, type: 'PRIVATE' });
    const channelId = created.body.id as string;

    await prisma.channelMember.create({
      data: { channelId, userId: TARGET_ID, role: targetRole },
    });
    return channelId;
  };

  beforeAll(async () => {
    await cleanupRoles();
    await createTestUser();
    await createSupportUsers();
  });

  afterAll(async () => {
    await cleanupRoles();
    await disconnectDatabase();
  });

  it('владелец повышает участника до MODERATOR', async () => {
    const channelId = await createChannelWithTarget('MEMBER');

    const response = await request(app)
      .patch(`/api/channels/${channelId}/members/${TARGET_ID}/role`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ role: 'MODERATOR' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: TARGET_ID, role: 'MODERATOR' });

    const record = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: TARGET_ID, channelId } },
    });
    expect(record?.role).toBe('MODERATOR');

    const members = await request(app)
      .get(`/api/channels/${channelId}/members`)
      .set('Authorization', `Bearer ${authToken()}`);
    const entry = members.body.find((member: { userId: string }) => member.userId === TARGET_ID);
    expect(entry.role).toBe('MODERATOR');
  });

  it('владелец понижает модератора до MEMBER', async () => {
    const channelId = await createChannelWithTarget('MODERATOR');

    const response = await request(app)
      .patch(`/api/channels/${channelId}/members/${TARGET_ID}/role`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ role: 'MEMBER' });

    expect(response.status).toBe(200);

    const record = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: TARGET_ID, channelId } },
    });
    expect(record?.role).toBe('MEMBER');
  });

  it('модератор не может менять роли (403)', async () => {
    const channelId = await createChannelWithTarget('MEMBER');
    await prisma.channelMember.create({
      data: { channelId, userId: MODERATOR_ID, role: 'MODERATOR' },
    });

    const moderatorToken = signAccessToken({ sub: MODERATOR_ID, role: 'USER' });
    const response = await request(app)
      .patch(`/api/channels/${channelId}/members/${TARGET_ID}/role`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ role: 'MODERATOR' });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('владелец');

    const record = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: TARGET_ID, channelId } },
    });
    expect(record?.role).toBe('MEMBER');
  });

  it('роль владельца изменить нельзя (400)', async () => {
    const channelId = await createChannelWithTarget('MEMBER');

    const response = await request(app)
      .patch(`/api/channels/${channelId}/members/${USER_ID}/role`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ role: 'MEMBER' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('владельца');

    const record = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: USER_ID, channelId } },
    });
    expect(record?.role).toBe('OWNER');
  });

  it('отклоняет назначение роли OWNER (400)', async () => {
    const channelId = await createChannelWithTarget('MEMBER');

    const response = await request(app)
      .patch(`/api/channels/${channelId}/members/${TARGET_ID}/role`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ role: 'OWNER' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('MEMBER или MODERATOR');
  });

  it('повторная смена на ту же роль возвращает 409', async () => {
    const channelId = await createChannelWithTarget('MEMBER');

    await request(app)
      .patch(`/api/channels/${channelId}/members/${TARGET_ID}/role`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ role: 'MODERATOR' });

    const response = await request(app)
      .patch(`/api/channels/${channelId}/members/${TARGET_ID}/role`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ role: 'MODERATOR' });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('уже имеет');
  });

  it('не-участник канала возвращает 404', async () => {
    const channelId = await createChannelWithTarget('MEMBER');

    const response = await request(app)
      .patch(`/api/channels/${channelId}/members/${MODERATOR_ID}/role`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ role: 'MODERATOR' });

    expect(response.status).toBe(404);
  });

  it('несуществующий канал возвращает 404', async () => {
    const response = await request(app)
      .patch(`/api/channels/00000000-0000-4000-8000-000000000000/members/${TARGET_ID}/role`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ role: 'MODERATOR' });

    expect(response.status).toBe(404);
  });

  it('отклоняет неизвестную роль (400)', async () => {
    const channelId = await createChannelWithTarget('MEMBER');

    const response = await request(app)
      .patch(`/api/channels/${channelId}/members/${TARGET_ID}/role`)
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ role: 'ADMIN' });

    expect(response.status).toBe(400);
  });

  it('отклоняет запрос без тела (400)', async () => {
    const channelId = await createChannelWithTarget('MEMBER');

    const response = await request(app)
      .patch(`/api/channels/${channelId}/members/${TARGET_ID}/role`)
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('MEMBER или MODERATOR');
  });

  it('возвращает 401 без токена', async () => {
    const response = await request(app)
      .patch(`/api/channels/00000000-0000-4000-8000-000000000000/members/${TARGET_ID}/role`)
      .send({ role: 'MODERATOR' });

    expect(response.status).toBe(401);
  });
});
