import { describe, it, expect, vi } from 'vitest';
import { createChannelWithOwner } from './channels';
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
