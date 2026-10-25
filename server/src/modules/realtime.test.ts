import { describe, it, expect, vi } from 'vitest';
import { type IncomingMessage } from 'http';
import { createRealtimeHub, parseClientFrame, AUTH_CLOSE_CODE, type ServerFrame } from './realtime';
import { signAccessToken } from '../services/auth';

// Идентификаторы тестового автора и канала
const AUTHOR_ID = 'user-uuid-1';
const CHANNEL_ID = 'channel-uuid-1';

// Запись сообщения в том виде, в каком её возвращает Prisma с include
const createdRow = {
  id: 'message-uuid-1',
  channelId: CHANNEL_ID,
  content: 'Добрый день!',
  authorId: AUTHOR_ID,
  createdAt: new Date('2026-10-24T12:40:00.000Z'),
  author: { fullName: 'Анна Петрова' },
};

// Ожидаемое представление сообщения после JSON-сериализации кадра:
// дата превращается в строку ISO
const expectedMessage = {
  id: 'message-uuid-1',
  channelId: CHANNEL_ID,
  content: 'Добрый день!',
  authorId: AUTHOR_ID,
  authorName: 'Анна Петрова',
  createdAt: '2026-10-24T12:40:00.000Z',
};

// Валидный токен сессии для заголовка подключения
const validToken = (userId = AUTHOR_ID): string => signAccessToken({ sub: userId, role: 'USER' });

// Запрос WebSocket-рукопожатия с токеном в query-параметре
const requestWithToken = (token: string | null): IncomingMessage => {
  const url = token === null ? '/ws' : `/ws?token=${token}`;
  return { url } as IncomingMessage;
};

// Мок сокета: запись отправленных кадров и событийная модель подписок
const createMockSocket = () => {
  const handlers = new Map<string, (data?: unknown) => void | Promise<void>>();
  const sent: ServerFrame[] = [];

  const socket = {
    send: vi.fn((raw: string) => {
      sent.push(JSON.parse(raw) as ServerFrame);
    }),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (data?: unknown) => void | Promise<void>) => {
      handlers.set(event, handler);
    }),
  };

  return {
    socket: socket as never,
    rawSocket: socket,
    sent,
    // Доставка клиентского кадра серверу
    emitMessage: (frame: unknown): Promise<void> =>
      Promise.resolve(handlers.get('message')?.(JSON.stringify(frame))),
    emitRaw: (raw: string): Promise<void> => Promise.resolve(handlers.get('message')?.(raw)),
    emitClose: (): void => {
      handlers.get('close')?.();
    },
  };
};

// Мок Prisma: по умолчанию автор состоит в канале и получает рассылку
const createMockPrisma = () => {
  const channel = { findUnique: vi.fn().mockResolvedValue({ id: CHANNEL_ID }) };
  const channelMember = {
    findUnique: vi.fn().mockResolvedValue({ userId: AUTHOR_ID }),
    findMany: vi.fn().mockResolvedValue([{ userId: AUTHOR_ID }]),
  };
  const message = {
    create: vi.fn().mockResolvedValue(createdRow),
    findUnique: vi.fn().mockResolvedValue({
      id: 'message-uuid-1',
      channelId: CHANNEL_ID,
      authorId: AUTHOR_ID,
    }),
    delete: vi.fn().mockResolvedValue(createdRow),
  };
  return { prisma: { channel, channelMember, message }, channel, channelMember, message };
};

describe('Unit Test: Разбор клиентских кадров', () => {
  it('разбирает кадр подписки на канал', () => {
    expect(parseClientFrame('{"type":"subscribe","channelId":"c1"}')).toEqual({
      type: 'subscribe',
      channelId: 'c1',
    });
  });

  it('разбирает кадр отписки от канала', () => {
    expect(parseClientFrame('{"type":"unsubscribe","channelId":"c1"}')).toEqual({
      type: 'unsubscribe',
      channelId: 'c1',
    });
  });

  it('разбирает кадр отправки сообщения', () => {
    expect(parseClientFrame('{"type":"send","channelId":"c1","content":"Привет"}')).toEqual({
      type: 'send',
      channelId: 'c1',
      content: 'Привет',
    });
  });

  it('разбирает кадр удаления сообщения', () => {
    expect(parseClientFrame('{"type":"delete","messageId":"m1"}')).toEqual({
      type: 'delete',
      messageId: 'm1',
    });
  });

  it('отклоняет кадр удаления без идентификатора сообщения', () => {
    expect(parseClientFrame('{"type":"delete"}')).toBeNull();
    expect(parseClientFrame('{"type":"delete","messageId":""}')).toBeNull();
    expect(parseClientFrame('{"type":"delete","messageId":42}')).toBeNull();
  });

  it('отклоняет некорректный JSON', () => {
    expect(parseClientFrame('не json')).toBeNull();
  });

  it('отклоняет кадр, не являющийся объектом', () => {
    expect(parseClientFrame('42')).toBeNull();
  });

  it('отклоняет кадр без идентификатора канала', () => {
    expect(parseClientFrame('{"type":"subscribe"}')).toBeNull();
  });

  it('отклоняет кадр с пустым идентификатором канала', () => {
    expect(parseClientFrame('{"type":"send","channelId":"","content":"Привет"}')).toBeNull();
  });

  it('отклоняет неизвестный тип кадра', () => {
    expect(parseClientFrame('{"type":"ping","channelId":"c1"}')).toBeNull();
  });

  it('отклоняет кадр отправки с нестроковым текстом', () => {
    expect(parseClientFrame('{"type":"send","channelId":"c1","content":42}')).toBeNull();
  });
});

describe('Unit Test: Аутентификация подключения', () => {
  it('отклоняет подключение без токена', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();

    hub.handleConnection(client.socket, requestWithToken(null));

    expect(client.rawSocket.close).toHaveBeenCalledWith(AUTH_CLOSE_CODE, expect.any(String));
    expect(client.rawSocket.on).not.toHaveBeenCalled();
  });

  it('отклоняет подключение без URL рукопожатия', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();

    hub.handleConnection(client.socket, { url: undefined } as IncomingMessage);

    expect(client.rawSocket.close).toHaveBeenCalledWith(AUTH_CLOSE_CODE, expect.any(String));
  });

  it('отклоняет подключение с невалидным токеном', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();

    hub.handleConnection(client.socket, requestWithToken('не-токен'));

    expect(client.rawSocket.close).toHaveBeenCalledWith(AUTH_CLOSE_CODE, expect.any(String));
  });

  it('обслуживает подключение с валидным токеном', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();

    hub.handleConnection(client.socket, requestWithToken(validToken()));

    expect(client.rawSocket.close).not.toHaveBeenCalled();
    expect(client.rawSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(client.rawSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
  });
});

describe('Unit Test: Подписка на каналы', () => {
  it('подписывает участника канала', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();
    hub.handleConnection(client.socket, requestWithToken(validToken()));

    await client.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });

    expect(client.sent).toEqual([{ type: 'subscribed', channelId: CHANNEL_ID }]);
    expect(mock.channelMember.findUnique).toHaveBeenCalledWith({
      where: { userId_channelId: { userId: AUTHOR_ID, channelId: CHANNEL_ID } },
      select: { userId: true },
    });
  });

  it('отклоняет подписку для не-участника канала', async () => {
    const mock = createMockPrisma();
    mock.channelMember.findUnique.mockResolvedValue(null);
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();
    hub.handleConnection(client.socket, requestWithToken(validToken()));

    await client.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });

    expect(client.sent).toEqual([
      { type: 'error', message: 'Подписка доступна только участникам канала' },
    ]);
  });

  it('отписывает от канала', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();
    hub.handleConnection(client.socket, requestWithToken(validToken()));

    await client.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });
    await client.emitMessage({ type: 'unsubscribe', channelId: CHANNEL_ID });

    expect(client.sent).toEqual([
      { type: 'subscribed', channelId: CHANNEL_ID },
      { type: 'unsubscribed', channelId: CHANNEL_ID },
    ]);
  });

  it('возвращает ошибку на некорректный кадр', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();
    hub.handleConnection(client.socket, requestWithToken(validToken()));

    await client.emitRaw('сломанный кадр');

    expect(client.sent).toEqual([{ type: 'error', message: 'Некорректный формат кадра' }]);
  });
});

describe('Unit Test: Отправка и рассылка сообщений', () => {
  it('сохраняет сообщение и рассылает его подписчикам канала', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const author = createMockSocket();
    const reader = createMockSocket();
    hub.handleConnection(author.socket, requestWithToken(validToken()));
    hub.handleConnection(reader.socket, requestWithToken(validToken()));

    await author.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });
    await reader.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });
    await author.emitMessage({
      type: 'send',
      channelId: CHANNEL_ID,
      content: '  Добрый день!  ',
    });

    // Текст обрезан, сообщение сохранено от имени автора из токена
    expect(mock.message.create).toHaveBeenCalledWith({
      data: { content: 'Добрый день!', authorId: AUTHOR_ID, channelId: CHANNEL_ID },
      include: { author: { select: { fullName: true } } },
    });

    const frame: ServerFrame = { type: 'message', message: expectedMessage };
    expect(author.sent).toContainEqual(frame);
    expect(reader.sent).toContainEqual(frame);
  });

  it('не рассылает сообщение неподписанному клиенту', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const author = createMockSocket();
    const reader = createMockSocket();
    hub.handleConnection(author.socket, requestWithToken(validToken()));
    hub.handleConnection(reader.socket, requestWithToken(validToken()));

    await author.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });
    await author.emitMessage({ type: 'send', channelId: CHANNEL_ID, content: 'Привет' });

    expect(reader.sent).toEqual([]);
  });

  it('не рассылает сообщение исключённому из канала подписчику', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const author = createMockSocket();
    const removed = createMockSocket();
    hub.handleConnection(author.socket, requestWithToken(validToken()));
    hub.handleConnection(removed.socket, requestWithToken(validToken('user-uuid-2')));

    await author.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });
    await removed.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });

    // Подписка была, но на момент рассылки состав канала изменился
    mock.channelMember.findMany.mockResolvedValue([{ userId: AUTHOR_ID }]);
    await author.emitMessage({ type: 'send', channelId: CHANNEL_ID, content: 'Привет' });

    expect(removed.sent).toEqual([{ type: 'subscribed', channelId: CHANNEL_ID }]);
  });

  it('отклоняет отправку пустого сообщения', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();
    hub.handleConnection(client.socket, requestWithToken(validToken()));

    await client.emitMessage({ type: 'send', channelId: CHANNEL_ID, content: '   ' });

    expect(mock.message.create).not.toHaveBeenCalled();
    expect(client.sent).toEqual([
      { type: 'error', message: expect.stringContaining('не может быть пустым') },
    ]);
  });

  it('отклоняет отправку в несуществующий канал', async () => {
    const mock = createMockPrisma();
    mock.channel.findUnique.mockResolvedValue(null);
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();
    hub.handleConnection(client.socket, requestWithToken(validToken()));

    await client.emitMessage({ type: 'send', channelId: CHANNEL_ID, content: 'Привет' });

    expect(client.sent).toEqual([{ type: 'error', message: 'Канал не найден' }]);
  });

  it('отклоняет отправку от не-участника канала', async () => {
    const mock = createMockPrisma();
    mock.channelMember.findUnique.mockResolvedValue(null);
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();
    hub.handleConnection(client.socket, requestWithToken(validToken()));

    await client.emitMessage({ type: 'send', channelId: CHANNEL_ID, content: 'Привет' });

    expect(client.sent).toEqual([
      { type: 'error', message: 'Отправка доступна только участникам канала' },
    ]);
  });

  it('удаляет подключение из рассылки при закрытии сокета', async () => {
    const mock = createMockPrisma();
    const hub = createRealtimeHub(mock.prisma as never);
    const author = createMockSocket();
    const reader = createMockSocket();
    hub.handleConnection(author.socket, requestWithToken(validToken()));
    hub.handleConnection(reader.socket, requestWithToken(validToken()));

    await author.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });
    await reader.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });
    reader.emitClose();

    await author.emitMessage({ type: 'send', channelId: CHANNEL_ID, content: 'Привет' });

    // Отключившийся клиент не получает рассылку
    expect(reader.sent).toEqual([{ type: 'subscribed', channelId: CHANNEL_ID }]);
  });
});

describe('Unit Test: Удаление сообщений через WebSocket', () => {
  it('удаляет сообщение и рассылает кадр message.deleted подписчикам', async () => {
    const mock = createMockPrisma();
    mock.channelMember.findMany.mockResolvedValue([
      { userId: AUTHOR_ID },
      { userId: 'user-uuid-2' },
    ]);
    const hub = createRealtimeHub(mock.prisma as never);
    const author = createMockSocket();
    const reader = createMockSocket();
    hub.handleConnection(author.socket, requestWithToken(validToken()));
    hub.handleConnection(reader.socket, requestWithToken(validToken('user-uuid-2')));

    await author.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });
    await reader.emitMessage({ type: 'subscribe', channelId: CHANNEL_ID });
    await author.emitMessage({ type: 'delete', messageId: 'message-uuid-1' });

    expect(mock.message.delete).toHaveBeenCalledWith({ where: { id: 'message-uuid-1' } });

    const deletedFrame = {
      type: 'message.deleted',
      channelId: CHANNEL_ID,
      messageId: 'message-uuid-1',
    };
    expect(author.sent).toContainEqual(deletedFrame);
    expect(reader.sent).toContainEqual(deletedFrame);
  });

  it('возвращает ошибку при удалении чужого сообщения', async () => {
    const mock = createMockPrisma();
    // Инициатор — MEMBER, автор сообщения другой пользователь
    mock.message.findUnique.mockResolvedValue({
      id: 'message-uuid-1',
      channelId: CHANNEL_ID,
      authorId: 'user-uuid-2',
    });
    mock.channelMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();
    hub.handleConnection(client.socket, requestWithToken(validToken()));

    await client.emitMessage({ type: 'delete', messageId: 'message-uuid-1' });

    expect(mock.message.delete).not.toHaveBeenCalled();
    expect(client.sent).toEqual([
      {
        type: 'error',
        message: 'Удалять сообщения может только автор, модератор или владелец',
      },
    ]);
  });

  it('возвращает ошибку при удалении несуществующего сообщения', async () => {
    const mock = createMockPrisma();
    mock.message.findUnique.mockResolvedValue(null);
    const hub = createRealtimeHub(mock.prisma as never);
    const client = createMockSocket();
    hub.handleConnection(client.socket, requestWithToken(validToken()));

    await client.emitMessage({ type: 'delete', messageId: 'message-uuid-1' });

    expect(mock.message.delete).not.toHaveBeenCalled();
    expect(client.sent).toEqual([{ type: 'error', message: 'Сообщение не найдено' }]);
  });
});
