import { describe, it, expect, vi } from 'vitest';
import { createMessage, listMessages, listChannelMemberIds, MAX_MESSAGE_LENGTH } from './messages';

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

// Ожидаемое транспортное представление сообщения
const expectedMessage = {
  id: 'message-uuid-1',
  channelId: CHANNEL_ID,
  content: 'Добрый день!',
  authorId: AUTHOR_ID,
  authorName: 'Анна Петрова',
  createdAt: new Date('2026-10-24T12:40:00.000Z'),
};

// Мок Prisma: по умолчанию канал существует и автор состоит в нём
const createMockPrisma = () => {
  const channel = { findUnique: vi.fn().mockResolvedValue({ id: CHANNEL_ID }) };
  const channelMember = {
    findUnique: vi.fn().mockResolvedValue({ userId: AUTHOR_ID }),
    findMany: vi.fn().mockResolvedValue([]),
  };
  const message = {
    create: vi.fn().mockResolvedValue(createdRow),
    findMany: vi.fn().mockResolvedValue([createdRow]),
  };
  return { prisma: { channel, channelMember, message }, channel, channelMember, message };
};

const validInput = { channelId: CHANNEL_ID, authorId: AUTHOR_ID, content: 'Добрый день!' };

describe('Unit Test: Сохранение сообщения', () => {
  it('сохраняет сообщение и возвращает имя автора и время', async () => {
    const mock = createMockPrisma();

    const result = await createMessage(mock.prisma as never, validInput);

    expect(result).toEqual({ status: 'sent', message: expectedMessage });
    expect(mock.message.create).toHaveBeenCalledWith({
      data: { content: 'Добрый день!', authorId: AUTHOR_ID, channelId: CHANNEL_ID },
      include: { author: { select: { fullName: true } } },
    });
  });

  it('обрезает пробелы по краям текста перед сохранением', async () => {
    const mock = createMockPrisma();

    await createMessage(mock.prisma as never, { ...validInput, content: '  Добрый день!  ' });

    expect(mock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: 'Добрый день!' }) }),
    );
  });

  it('отклоняет сообщение из одних пробелов как некорректное', async () => {
    const mock = createMockPrisma();

    const result = await createMessage(mock.prisma as never, { ...validInput, content: '   ' });

    expect(result).toEqual({ status: 'invalid' });
    expect(mock.message.create).not.toHaveBeenCalled();
  });

  it(`отклоняет текст длиннее ${MAX_MESSAGE_LENGTH} символов`, async () => {
    const mock = createMockPrisma();

    const result = await createMessage(mock.prisma as never, {
      ...validInput,
      content: 'а'.repeat(MAX_MESSAGE_LENGTH + 1),
    });

    expect(result).toEqual({ status: 'invalid' });
    expect(mock.message.create).not.toHaveBeenCalled();
  });

  it('возвращает not_found для несуществующего канала', async () => {
    const mock = createMockPrisma();
    mock.channel.findUnique.mockResolvedValue(null);

    const result = await createMessage(mock.prisma as never, validInput);

    expect(result).toEqual({ status: 'not_found' });
    expect(mock.message.create).not.toHaveBeenCalled();
  });

  it('запрещает отправку пользователю вне состава канала', async () => {
    const mock = createMockPrisma();
    mock.channelMember.findUnique.mockResolvedValue(null);

    const result = await createMessage(mock.prisma as never, validInput);

    expect(result).toEqual({ status: 'forbidden' });
    expect(mock.message.create).not.toHaveBeenCalled();
  });
});

describe('Unit Test: Лента сообщений канала', () => {
  it('возвращает сообщения с именами авторов в хронологическом порядке', async () => {
    const mock = createMockPrisma();
    const laterRow = {
      ...createdRow,
      id: 'message-uuid-2',
      content: 'Принято.',
      createdAt: new Date('2026-10-24T12:41:00.000Z'),
    };
    mock.message.findMany.mockResolvedValue([createdRow, laterRow]);

    const result = await listMessages(mock.prisma as never, CHANNEL_ID, AUTHOR_ID);

    expect(result.status).toBe('ok');
    expect(result).toMatchObject({
      messages: [
        expectedMessage,
        {
          id: 'message-uuid-2',
          content: 'Принято.',
          authorName: 'Анна Петрова',
          createdAt: new Date('2026-10-24T12:41:00.000Z'),
        },
      ],
    });
    // Ключ сортировки: от старых к новым, id — стабилизатор порядка
    expect(mock.message.findMany).toHaveBeenCalledWith({
      where: { channelId: CHANNEL_ID },
      include: { author: { select: { fullName: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('возвращает пустую ленту для канала без сообщений', async () => {
    const mock = createMockPrisma();
    mock.message.findMany.mockResolvedValue([]);

    const result = await listMessages(mock.prisma as never, CHANNEL_ID, AUTHOR_ID);

    expect(result).toEqual({ status: 'ok', messages: [] });
  });

  it('возвращает not_found для несуществующего канала', async () => {
    const mock = createMockPrisma();
    mock.channelMember.findUnique.mockResolvedValue(null);
    mock.channel.findUnique.mockResolvedValue(null);

    const result = await listMessages(mock.prisma as never, CHANNEL_ID, AUTHOR_ID);

    expect(result).toEqual({ status: 'not_found' });
    expect(mock.message.findMany).not.toHaveBeenCalled();
  });

  it('запрещает чтение ленты пользователю вне состава канала', async () => {
    const mock = createMockPrisma();
    mock.channelMember.findUnique.mockResolvedValue(null);

    const result = await listMessages(mock.prisma as never, CHANNEL_ID, AUTHOR_ID);

    expect(result).toEqual({ status: 'forbidden' });
    expect(mock.message.findMany).not.toHaveBeenCalled();
  });
});

describe('Unit Test: Идентификаторы участников канала', () => {
  it('возвращает идентификаторы всех участников канала', async () => {
    const mock = createMockPrisma();
    mock.channelMember.findMany.mockResolvedValue([
      { userId: AUTHOR_ID },
      { userId: 'user-uuid-2' },
    ]);

    const result = await listChannelMemberIds(mock.prisma as never, CHANNEL_ID);

    expect(result).toEqual([AUTHOR_ID, 'user-uuid-2']);
    expect(mock.channelMember.findMany).toHaveBeenCalledWith({
      where: { channelId: CHANNEL_ID },
      select: { userId: true },
    });
  });

  it('возвращает пустой список для канала без участников', async () => {
    const mock = createMockPrisma();

    const result = await listChannelMemberIds(mock.prisma as never, CHANNEL_ID);

    expect(result).toEqual([]);
  });
});
