import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma, disconnectDatabase } from '../db';
import { signAccessToken } from '../utils/token';

// Уникальный префикс тестовых данных для изоляции прогонов
const RUN_ID = Date.now();
const USER_ID = `user-${RUN_ID}`;

// Очистка тестовых каналов и пользователя до и после прогона
const cleanup = async (): Promise<void> => {
  await prisma.channel.deleteMany({ where: { name: { startsWith: 'test-channel' } } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
};

// Создание тестового пользователя напрямую в БД (минуя регистрацию)
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

// Получение валидного токена сессии тестового пользователя
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

    // Критерий 2: канал сохранён в PostgreSQL
    const channel = await prisma.channel.findUnique({ where: { id: response.body.id } });
    expect(channel).not.toBeNull();
    expect(channel?.name).toBe(`test-channel-public-${RUN_ID}`);

    // Критерий 3: создатель добавлен участником с ролью OWNER
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
  // Второй пользователь: владелец приватного канала
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
    // Публичный канал создаёт второй пользователь
    const publicChannel = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${signAccessToken({ sub: OTHER_ID, role: 'USER' })}`)
      .send({ name: `catalog-public-${RUN_ID}`, type: 'PUBLIC' });

    // Приватный канал — тоже второй пользователь, текущий в него не входит
    const privateChannel = await request(app)
      .post('/api/channels')
      .set('Authorization', `Bearer ${signAccessToken({ sub: OTHER_ID, role: 'USER' })}`)
      .send({ name: `catalog-private-${RUN_ID}`, type: 'PRIVATE' });

    const response = await request(app)
      .get('/api/channels/catalog')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(response.status).toBe(200);

    const names = response.body.map((channel: { name: string }) => channel.name);
    // Критерий 1: публичный виден как не-участник
    expect(names).toContain(`catalog-public-${RUN_ID}`);
    // Критерий 1: чужой приватный канал скрыт
    expect(names).not.toContain(`catalog-private-${RUN_ID}`);

    const publicEntry = response.body.find(
      (channel: { name: string }) => channel.name === `catalog-public-${RUN_ID}`,
    );
    expect(publicEntry.isMember).toBe(false);
    expect(publicEntry.type).toBe('PUBLIC');
    // Идентификаторы созданных каналов нужны следующим тестам
    expect(publicChannel.status).toBe(201);
    expect(privateChannel.status).toBe(201);
  });

  it('отмечает канал пользователя как участник', async () => {
    // Текущий пользователь создаёт приватный канал — он же его владелец
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
    // Критерий 1: собственный приватный канал виден и помечен
    expect(own).toMatchObject({ type: 'PRIVATE', isMember: true });
  });

  it('возвращает 401 без токена', async () => {
    const response = await request(app).get('/api/channels/catalog');
    expect(response.status).toBe(401);
  });
});
