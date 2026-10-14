import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import bcrypt from 'bcrypt';
import { createAuthRouter } from './registration';
import { type PrismaClient } from '../generated/prisma/client';

// Тестовые данные
const validInput = {
  fullName: 'Иванов Иван Иванович',
  email: 'ivanov@corp.messenger.com',
  password: 'secretPass123',
};

const createdUser = {
  id: 'user-uuid-1',
  fullName: validInput.fullName,
  email: validInput.email,
  globalRole: 'USER' as const,
  status: 'ACTIVE' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  passwordHash: 'hash',
};

// Мок PrismaClient: findUnique возвращает null (email свободен)
const createMockPrisma = () => ({
  user: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(createdUser),
  },
});

const createTestApp = (mockPrisma: ReturnType<typeof createMockPrisma>) => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(mockPrisma as unknown as PrismaClient));
  return app;
};

describe('Unit Test: Модуль регистрации сотрудников', () => {
  it('создаёт аккаунт и возвращает 201 без данных пароля', async () => {
    const mock = createMockPrisma();
    const response = await request(createTestApp(mock)).post('/api/auth/register').send(validInput);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: 'user-uuid-1',
      fullName: validInput.fullName,
      email: validInput.email,
      globalRole: 'USER',
      status: 'ACTIVE',
    });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('хэширует пароль bcrypt перед сохранением в БД', async () => {
    const mock = createMockPrisma();
    await request(createTestApp(mock)).post('/api/auth/register').send(validInput);

    const createCall = mock.user.create.mock.calls[0][0];
    const savedHash = createCall.data.passwordHash;

    expect(savedHash).not.toBe(validInput.password);
    expect(await bcrypt.compare(validInput.password, savedHash)).toBe(true);
  });

  it('отклоняет email вне домена @corp.messenger.com с кодом 400', async () => {
    const mock = createMockPrisma();
    const response = await request(createTestApp(mock))
      .post('/api/auth/register')
      .send({ ...validInput, email: 'user@gmail.com' });

    expect(response.status).toBe(400);
    expect(mock.user.create).not.toHaveBeenCalled();
  });

  it('отклоняет короткий пароль (< 8 символов) с кодом 400', async () => {
    const mock = createMockPrisma();
    const response = await request(createTestApp(mock))
      .post('/api/auth/register')
      .send({ ...validInput, password: '12345' });

    expect(response.status).toBe(400);
    expect(mock.user.create).not.toHaveBeenCalled();
  });

  it('отклоняет пустое имя с кодом 400', async () => {
    const mock = createMockPrisma();
    const response = await request(createTestApp(mock))
      .post('/api/auth/register')
      .send({ ...validInput, fullName: '   ' });

    expect(response.status).toBe(400);
    expect(mock.user.create).not.toHaveBeenCalled();
  });

  it('отклоняет запрос без тела с кодом 400', async () => {
    const mock = createMockPrisma();
    const response = await request(createTestApp(mock)).post('/api/auth/register');

    expect(response.status).toBe(400);
    expect(mock.user.create).not.toHaveBeenCalled();
  });

  it('возвращает 409 при попытке регистрации занятого email', async () => {
    const mock = createMockPrisma();
    mock.user.findUnique.mockResolvedValue(createdUser);

    const response = await request(createTestApp(mock)).post('/api/auth/register').send(validInput);

    expect(response.status).toBe(409);
    expect(mock.user.create).not.toHaveBeenCalled();
  });

  it('обрабатывает гонку уникальности (P2002) как 409', async () => {
    const mock = createMockPrisma();
    mock.user.create.mockRejectedValue({ code: 'P2002' });

    const response = await request(createTestApp(mock)).post('/api/auth/register').send(validInput);

    expect(response.status).toBe(409);
  });

  it('пробрасывает непредвиденную ошибку БД как 500', async () => {
    const mock = createMockPrisma();
    mock.user.create.mockRejectedValue(new Error('connection lost'));

    const response = await request(createTestApp(mock)).post('/api/auth/register').send(validInput);

    expect(response.status).toBe(500);
  });
});
