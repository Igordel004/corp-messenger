import { describe, it, expect, vi } from 'vitest';
import {
  createChannelWithOwner,
  listUserChannels,
  listChannelCatalog,
  joinChannel,
  listChannelMembers,
  addChannelMember,
} from './channels';
import { ChannelType, ChannelRole } from '../generated/prisma/enums';

// Идентификатор тестового создателя
const CREATOR_ID = 'user-uuid-1';

const input = {
  name: 'Разработка',
  type: ChannelType.PUBLIC,
  creatorId: CREATOR_ID,
};

const createdChannel = {
  id: 'channel-uuid-1',
  name: 'Разработка',
  type: ChannelType.PUBLIC,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Мок Prisma: транзакция прокидывает пробы вложенных операций
const createMockPrisma = () => {
  const channel = { create: vi.fn().mockResolvedValue(createdChannel) };
  const channelMember = { create: vi.fn().mockResolvedValue({}) };
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ channel, channelMember }),
  );
  return { prisma: { $transaction }, channel, channelMember };
};

describe('Unit Test: Транзакционное создание канала', () => {
  it('создаёт канал и запись участника с ролью OWNER', async () => {
    const mock = createMockPrisma();

    const result = await createChannelWithOwner(mock.prisma as never, input);

    expect(result).toEqual(createdChannel);
    expect(mock.channel.create).toHaveBeenCalledWith({
      data: { name: 'Разработка', type: ChannelType.PUBLIC },
    });
    expect(mock.channelMember.create).toHaveBeenCalledWith({
      data: {
        channelId: createdChannel.id,
        userId: CREATOR_ID,
        role: ChannelRole.OWNER,
      },
    });
  });

  it('выполняет обе записи внутри одной транзакции', async () => {
    const mock = createMockPrisma();

    await createChannelWithOwner(mock.prisma as never, input);

    expect(mock.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('пробрасывает ошибку транзакции, не создавая частичных записей', async () => {
    const mock = createMockPrisma();
    // Ошибка на этапе создания участника: транзакция должна откатиться
    mock.channelMember.create.mockRejectedValue(new Error('constraint failed'));

    await expect(createChannelWithOwner(mock.prisma as never, input)).rejects.toThrow(
      'constraint failed',
    );
    // Участник не создан, канал — в рамках транзакции (откат Prisma)
    expect(mock.channelMember.create).toHaveBeenCalledTimes(1);
  });

  it('приватный канал создаётся с корректным типом', async () => {
    const mock = createMockPrisma();

    await createChannelWithOwner(mock.prisma as never, {
      ...input,
      type: ChannelType.PRIVATE,
    });

    expect(mock.channel.create).toHaveBeenCalledWith({
      data: { name: 'Разработка', type: ChannelType.PRIVATE },
    });
  });
});

describe('Unit Test: Список каналов пользователя', () => {
  it('преобразует записи участничества в каналы с локальной ролью', async () => {
    const joinedAt = new Date('2026-01-01T10:00:00Z');
    const findMany = vi.fn().mockResolvedValue([
      {
        role: ChannelRole.OWNER,
        joinedAt,
        channel: { id: 'ch-1', name: 'Разработка', type: ChannelType.PUBLIC },
      },
      {
        role: ChannelRole.MEMBER,
        joinedAt,
        channel: { id: 'ch-2', name: 'Маркетинг', type: ChannelType.PRIVATE },
      },
    ]);
    const prisma = { channelMember: { findMany } };

    const result = await listUserChannels(prisma as never, CREATOR_ID);

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: CREATOR_ID },
      include: { channel: true },
      orderBy: { joinedAt: 'asc' },
    });
    expect(result).toEqual([
      {
        id: 'ch-1',
        name: 'Разработка',
        type: ChannelType.PUBLIC,
        role: ChannelRole.OWNER,
        joinedAt,
      },
      {
        id: 'ch-2',
        name: 'Маркетинг',
        type: ChannelType.PRIVATE,
        role: ChannelRole.MEMBER,
        joinedAt,
      },
    ]);
  });

  it('возвращает пустой список при отсутствии участничества', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { channelMember: { findMany } };

    const result = await listUserChannels(prisma as never, CREATOR_ID);

    expect(result).toEqual([]);
  });
});

describe('Unit Test: Каталог каналов', () => {
  // Канал с отметкой об участии пользователя (или без неё)
  const channel = (id: string, name: string, type: ChannelType, memberIds: string[]) => ({
    id,
    name,
    type,
    createdAt: new Date(),
    updatedAt: new Date(),
    members: memberIds.map((userId) => ({ id: `m-${userId}` })),
  });

  it('включает все публичные каналы независимо от участия', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        channel('ch-1', 'Общий', ChannelType.PUBLIC, []),
        channel('ch-2', 'Разработка', ChannelType.PUBLIC, [CREATOR_ID]),
      ]);
    const prisma = { channel: { findMany } };

    const result = await listChannelCatalog(prisma as never, CREATOR_ID);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'ch-1', isMember: false });
    expect(result[1]).toMatchObject({ id: 'ch-2', isMember: true });
  });

  it('скрывает приватные каналы без участия пользователя', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        channel('ch-1', 'Секретный', ChannelType.PRIVATE, []),
        channel('ch-2', 'Финансы', ChannelType.PRIVATE, [CREATOR_ID]),
      ]);
    const prisma = { channel: { findMany } };

    const result = await listChannelCatalog(prisma as never, CREATOR_ID);

    // Приватный канал чужого пользователя не виден
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'ch-2', isMember: true });
  });

  it('передаёт фильтр участника в запрос к базе', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { channel: { findMany } };

    await listChannelCatalog(prisma as never, CREATOR_ID);

    expect(findMany).toHaveBeenCalledWith({
      include: {
        members: { where: { userId: CREATOR_ID }, select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('возвращает пустой каталог при отсутствии каналов', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { channel: { findMany } };

    expect(await listChannelCatalog(prisma as never, CREATOR_ID)).toEqual([]);
  });
});

describe('Unit Test: Вступление в канал', () => {
  const CHANNEL_ID = 'ch-1';

  // Мок канала с заданным типом и составом участников
  const mockChannel = (type: ChannelType, memberIds: string[] = []) => ({
    channel: {
      findUnique: vi.fn().mockResolvedValue({
        id: CHANNEL_ID,
        name: 'Общий',
        type,
        createdAt: new Date(),
        updatedAt: new Date(),
        members: memberIds.map((id) => ({ id: `m-${id}` })),
      }),
    },
    channelMember: {
      create: vi.fn().mockResolvedValue({}),
    },
  });

  it('добавляет участника с ролью MEMBER в публичный канал', async () => {
    const mock = mockChannel(ChannelType.PUBLIC);

    const result = await joinChannel(mock as never, CHANNEL_ID, CREATOR_ID);

    expect(result).toEqual({
      status: 'joined',
      channel: { id: CHANNEL_ID, name: 'Общий', type: ChannelType.PUBLIC },
    });
    expect(mock.channelMember.create).toHaveBeenCalledWith({
      data: { channelId: CHANNEL_ID, userId: CREATOR_ID, role: ChannelRole.MEMBER },
    });
  });

  it('возвращает not_found для несуществующего канала', async () => {
    const mock = mockChannel(ChannelType.PUBLIC);
    mock.channel.findUnique.mockResolvedValue(null);

    expect(await joinChannel(mock as never, CHANNEL_ID, CREATOR_ID)).toEqual({
      status: 'not_found',
    });
    expect(mock.channelMember.create).not.toHaveBeenCalled();
  });

  it('возвращает already_member для действующего участника', async () => {
    const mock = mockChannel(ChannelType.PUBLIC, [CREATOR_ID]);

    expect(await joinChannel(mock as never, CHANNEL_ID, CREATOR_ID)).toEqual({
      status: 'already_member',
    });
    expect(mock.channelMember.create).not.toHaveBeenCalled();
  });

  it('запрещает вступление в приватный канал', async () => {
    const mock = mockChannel(ChannelType.PRIVATE);

    expect(await joinChannel(mock as never, CHANNEL_ID, CREATOR_ID)).toEqual({
      status: 'private',
    });
    expect(mock.channelMember.create).not.toHaveBeenCalled();
  });

  it('обрабатывает гонку параллельных вступлений как already_member', async () => {
    const mock = mockChannel(ChannelType.PUBLIC);
    mock.channelMember.create.mockRejectedValue({ code: 'P2002' });

    expect(await joinChannel(mock as never, CHANNEL_ID, CREATOR_ID)).toEqual({
      status: 'already_member',
    });
  });

  it('пробрасывает непредвиденную ошибку базы данных', async () => {
    const mock = mockChannel(ChannelType.PUBLIC);
    mock.channelMember.create.mockRejectedValue(new Error('connection lost'));

    await expect(joinChannel(mock as never, CHANNEL_ID, CREATOR_ID)).rejects.toThrow(
      'connection lost',
    );
  });
});

describe('Unit Test: Список участников канала', () => {
  const CHANNEL_ID = 'ch-1';
  const joinedAt = new Date('2026-01-01T10:00:00Z');

  // Мок: участник канала и список его участников
  const mockMembers = (members: Array<{ userId: string; role: ChannelRole }>) => ({
    channelMember: {
      findUnique: vi.fn().mockResolvedValue({ id: 'm-requester' }),
      findMany: vi.fn().mockResolvedValue(
        members.map((member) => ({
          userId: member.userId,
          role: member.role,
          joinedAt,
          user: {
            fullName: `Сотрудник ${member.userId}`,
            email: `${member.userId}@corp.messenger.com`,
          },
        })),
      ),
    },
    channel: {
      findUnique: vi.fn().mockResolvedValue({ id: CHANNEL_ID }),
    },
  });

  it('возвращает участников с ролями для участника канала', async () => {
    const mock = mockMembers([
      { userId: CREATOR_ID, role: ChannelRole.OWNER },
      { userId: 'user-2', role: ChannelRole.MEMBER },
    ]);

    const result = await listChannelMembers(mock as never, CHANNEL_ID, CREATOR_ID);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.members).toHaveLength(2);
    expect(result.members[0]).toEqual({
      userId: CREATOR_ID,
      fullName: `Сотрудник ${CREATOR_ID}`,
      email: `${CREATOR_ID}@corp.messenger.com`,
      role: ChannelRole.OWNER,
      joinedAt,
    });
    expect(result.members[1].role).toBe(ChannelRole.MEMBER);
  });

  it('ищет участничество по составному ключу', async () => {
    const mock = mockMembers([{ userId: CREATOR_ID, role: ChannelRole.OWNER }]);

    await listChannelMembers(mock as never, CHANNEL_ID, CREATOR_ID);

    expect(mock.channelMember.findUnique).toHaveBeenCalledWith({
      where: { userId_channelId: { userId: CREATOR_ID, channelId: CHANNEL_ID } },
    });
  });

  it('сортирует участников по дате вступления', async () => {
    const mock = mockMembers([{ userId: CREATOR_ID, role: ChannelRole.OWNER }]);

    await listChannelMembers(mock as never, CHANNEL_ID, CREATOR_ID);

    expect(mock.channelMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { joinedAt: 'asc' } }),
    );
  });

  it('запрещает список постороннему при существующем канале', async () => {
    const mock = mockMembers([]);
    mock.channelMember.findUnique.mockResolvedValue(null);

    const result = await listChannelMembers(mock as never, CHANNEL_ID, 'stranger');

    expect(result).toEqual({ status: 'forbidden' });
    expect(mock.channelMember.findMany).not.toHaveBeenCalled();
  });

  it('возвращает not_found для несуществующего канала', async () => {
    const mock = mockMembers([]);
    mock.channelMember.findUnique.mockResolvedValue(null);
    mock.channel.findUnique.mockResolvedValue(null);

    const result = await listChannelMembers(mock as never, CHANNEL_ID, 'stranger');

    expect(result).toEqual({ status: 'not_found' });
  });
});

describe('Unit Test: Добавление участника в канал', () => {
  const CHANNEL_ID = 'ch-1';
  const INVITEE_ID = 'user-2';

  const invitee = {
    id: INVITEE_ID,
    fullName: 'Приглашённый Сотрудник',
    email: 'invitee@corp.messenger.com',
  };

  // Мок с ролью запросившего в канале
  const mockAdd = (requesterRole: ChannelRole | null) => {
    const mock = {
      channel: {
        findUnique: vi.fn().mockResolvedValue({
          id: CHANNEL_ID,
          members: requesterRole ? [{ role: requesterRole }] : [],
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(invitee),
      },
      channelMember: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    return mock;
  };

  it('владелец добавляет участника с ролью MEMBER', async () => {
    const mock = mockAdd(ChannelRole.OWNER);

    const result = await addChannelMember(mock as never, CHANNEL_ID, CREATOR_ID, invitee.email);

    expect(result).toEqual({
      status: 'added',
      member: {
        userId: INVITEE_ID,
        fullName: invitee.fullName,
        email: invitee.email,
        role: ChannelRole.MEMBER,
      },
    });
    expect(mock.channelMember.create).toHaveBeenCalledWith({
      data: { channelId: CHANNEL_ID, userId: INVITEE_ID, role: ChannelRole.MEMBER },
    });
  });

  it('модератор тоже может добавлять участников', async () => {
    const mock = mockAdd(ChannelRole.MODERATOR);

    const result = await addChannelMember(mock as never, CHANNEL_ID, CREATOR_ID, invitee.email);

    expect(result.status).toBe('added');
  });

  it('обычный участник не может добавлять (403)', async () => {
    const mock = mockAdd(ChannelRole.MEMBER);

    const result = await addChannelMember(mock as never, CHANNEL_ID, CREATOR_ID, invitee.email);

    expect(result).toEqual({ status: 'forbidden' });
    expect(mock.channelMember.create).not.toHaveBeenCalled();
  });

  it('посторонний не может добавлять (403)', async () => {
    const mock = mockAdd(null);

    const result = await addChannelMember(mock as never, CHANNEL_ID, 'stranger', invitee.email);

    expect(result).toEqual({ status: 'forbidden' });
    expect(mock.user.findUnique).not.toHaveBeenCalled();
  });

  it('возвращает not_found для несуществующего канала', async () => {
    const mock = mockAdd(ChannelRole.OWNER);
    mock.channel.findUnique.mockResolvedValue(null);

    const result = await addChannelMember(mock as never, CHANNEL_ID, CREATOR_ID, invitee.email);

    expect(result).toEqual({ status: 'not_found' });
  });

  it('возвращает user_not_found для неизвестного email', async () => {
    const mock = mockAdd(ChannelRole.OWNER);
    mock.user.findUnique.mockResolvedValue(null);

    const result = await addChannelMember(
      mock as never,
      CHANNEL_ID,
      CREATOR_ID,
      'ghost@corp.messenger.com',
    );

    expect(result).toEqual({ status: 'user_not_found' });
    expect(mock.channelMember.create).not.toHaveBeenCalled();
  });

  it('возвращает already_member для действующего участника', async () => {
    const mock = mockAdd(ChannelRole.OWNER);
    mock.channelMember.findUnique.mockResolvedValue({ id: 'm-existing' });

    const result = await addChannelMember(mock as never, CHANNEL_ID, CREATOR_ID, invitee.email);

    expect(result).toEqual({ status: 'already_member' });
    expect(mock.channelMember.create).not.toHaveBeenCalled();
  });

  it('обрабатывает гонку параллельных добавлений как already_member', async () => {
    const mock = mockAdd(ChannelRole.OWNER);
    mock.channelMember.create.mockRejectedValue({ code: 'P2002' });

    const result = await addChannelMember(mock as never, CHANNEL_ID, CREATOR_ID, invitee.email);

    expect(result).toEqual({ status: 'already_member' });
  });

  it('пробрасывает непредвиденную ошибку базы данных', async () => {
    const mock = mockAdd(ChannelRole.OWNER);
    mock.channelMember.create.mockRejectedValue(new Error('connection lost'));

    await expect(
      addChannelMember(mock as never, CHANNEL_ID, CREATOR_ID, invitee.email),
    ).rejects.toThrow('connection lost');
  });
});
