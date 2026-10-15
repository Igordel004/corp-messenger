import { type PrismaClient } from '../generated/prisma/client';
import { ChannelType, ChannelRole } from '../generated/prisma/enums';

// Данные нового канала
export interface CreateChannelInput {
  name: string;
  type: ChannelType;
  /** Идентификатор создателя — становится владельцем канала */
  creatorId: string;
}

// Канал, возвращаемый после создания
export interface CreatedChannel {
  id: string;
  name: string;
  type: ChannelType;
  createdAt: Date;
}

// Создание канала и назначение создателя владельцем выполняются
// атомарно: либо канал существует вместе с участником-владельцем,
// либо не существует ничего (критерий готовности 3).
export const createChannelWithOwner = async (
  prisma: PrismaClient,
  input: CreateChannelInput,
): Promise<CreatedChannel> => {
  return prisma.$transaction(async (tx) => {
    const channel = await tx.channel.create({
      data: { name: input.name, type: input.type },
    });

    await tx.channelMember.create({
      data: {
        channelId: channel.id,
        userId: input.creatorId,
        role: ChannelRole.OWNER,
      },
    });

    return channel;
  });
};

// Каналы текущего пользователя с локальной ролью — для боковой панели
export interface UserChannel {
  id: string;
  name: string;
  type: ChannelType;
  role: ChannelRole;
  joinedAt: Date;
}

export const listUserChannels = async (
  prisma: PrismaClient,
  userId: string,
): Promise<UserChannel[]> => {
  const memberships = await prisma.channelMember.findMany({
    where: { userId },
    include: { channel: true },
    orderBy: { joinedAt: 'asc' },
  });

  return memberships.map((membership) => ({
    id: membership.channel.id,
    name: membership.channel.name,
    type: membership.channel.type,
    role: membership.role,
    joinedAt: membership.joinedAt,
  }));
};

// Строка каталога: канал с признаком участия текущего пользователя
export interface CatalogChannel {
  id: string;
  name: string;
  type: ChannelType;
  isMember: boolean;
}

// Каталог каналов: все публичные и приватные, где пользователь состоит.
// Приватные каналы без участия пользователя в каталог не попадают —
// их существование для посторонних скрыто.
export const listChannelCatalog = async (
  prisma: PrismaClient,
  userId: string,
): Promise<CatalogChannel[]> => {
  const channels = await prisma.channel.findMany({
    include: {
      members: { where: { userId }, select: { id: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return channels
    .filter((channel) => channel.type === 'PUBLIC' || channel.members.length > 0)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      isMember: channel.members.length > 0,
    }));
};

// Результат попытки вступить в канал
export type JoinChannelResult =
  | { status: 'joined'; channel: { id: string; name: string; type: ChannelType } }
  | { status: 'not_found' }
  | { status: 'private' }
  | { status: 'already_member' };

// Вступление в публичный канал: участник получает роль MEMBER.
// Приватные каналы недоступны — по критерию готовности вступление
// возможно только в открытый канал.
export const joinChannel = async (
  prisma: PrismaClient,
  channelId: string,
  userId: string,
): Promise<JoinChannelResult> => {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { members: { where: { userId }, select: { id: true } } },
  });

  if (!channel) {
    return { status: 'not_found' };
  }
  if (channel.members.length > 0) {
    return { status: 'already_member' };
  }
  if (channel.type === 'PRIVATE') {
    return { status: 'private' };
  }

  try {
    await prisma.channelMember.create({
      data: { channelId, userId, role: ChannelRole.MEMBER },
    });
  } catch (error) {
    // Гонка параллельных вступлений: уникальный индекс (user, channel)
    // превращает повтор в отказ «уже участник»
    const code = (error as { code?: string }).code;
    if (code === 'P2002') {
      return { status: 'already_member' };
    }
    throw error;
  }

  return {
    status: 'joined',
    channel: { id: channel.id, name: channel.name, type: channel.type },
  };
};

// Участник канала для панели состава
export interface ChannelMemberInfo {
  userId: string;
  fullName: string;
  email: string;
  role: ChannelRole;
  joinedAt: Date;
}

// Результат запроса списка участников
export type MemberListResult =
  | { status: 'ok'; members: ChannelMemberInfo[] }
  | { status: 'not_found' }
  | { status: 'forbidden' };

// Список участников канала: виден только участникам канала:
// состав приватного канала не раскрывается посторонним.
export const listChannelMembers = async (
  prisma: PrismaClient,
  channelId: string,
  requesterId: string,
): Promise<MemberListResult> => {
  const requester = await prisma.channelMember.findUnique({
    where: { userId_channelId: { userId: requesterId, channelId } },
  });

  if (!requester) {
    // Разделяем «канала нет» и «нет доступа», чтобы не раскрывать существование
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });
    return channel ? { status: 'forbidden' } : { status: 'not_found' };
  }

  const members = await prisma.channelMember.findMany({
    where: { channelId },
    include: { user: { select: { fullName: true, email: true } } },
    orderBy: { joinedAt: 'asc' },
  });

  return {
    status: 'ok',
    members: members.map((member) => ({
      userId: member.userId,
      fullName: member.user.fullName,
      email: member.user.email,
      role: member.role,
      joinedAt: member.joinedAt,
    })),
  };
};

// Результат добавления участника
export type AddMemberResult =
  | {
      status: 'added';
      member: { userId: string; fullName: string; email: string; role: ChannelRole };
    }
  | { status: 'not_found' }
  | { status: 'user_not_found' }
  | { status: 'forbidden' }
  | { status: 'already_member' };

// Добавление участника в канал по email сотрудника.
// По критерию готовности право добавлять есть у владельца и модератора;
// новый участник получает роль MEMBER.
export const addChannelMember = async (
  prisma: PrismaClient,
  channelId: string,
  requesterId: string,
  inviteeEmail: string,
): Promise<AddMemberResult> => {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { members: { where: { userId: requesterId }, select: { role: true } } },
  });

  if (!channel) {
    return { status: 'not_found' };
  }

  const requesterRole = channel.members[0]?.role;
  if (requesterRole !== ChannelRole.OWNER && requesterRole !== ChannelRole.MODERATOR) {
    return { status: 'forbidden' };
  }

  const invitee = await prisma.user.findUnique({ where: { email: inviteeEmail } });
  if (!invitee) {
    return { status: 'user_not_found' };
  }

  const existing = await prisma.channelMember.findUnique({
    where: { userId_channelId: { userId: invitee.id, channelId } },
  });
  if (existing) {
    return { status: 'already_member' };
  }

  try {
    await prisma.channelMember.create({
      data: { channelId, userId: invitee.id, role: ChannelRole.MEMBER },
    });
  } catch (error) {
    // Гонка параллельных добавлений: уникальный индекс превращает повтор в отказ
    const code = (error as { code?: string }).code;
    if (code === 'P2002') {
      return { status: 'already_member' };
    }
    throw error;
  }

  return {
    status: 'added',
    member: {
      userId: invitee.id,
      fullName: invitee.fullName,
      email: invitee.email,
      role: ChannelRole.MEMBER,
    },
  };
};

// Результат исключения участника
export type RemoveMemberResult =
  | { status: 'removed' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'target_not_found' }
  | { status: 'owner_protected' };

// Исключение участника из канала. По критерию готовности действие
// доступно только владельцу; владелец исключить себя не может —
// канал не должен остаться без OWNER. Запись удаляется из БД,
// участник теряет доступ к каналу.
export const removeChannelMember = async (
  prisma: PrismaClient,
  channelId: string,
  requesterId: string,
  targetUserId: string,
): Promise<RemoveMemberResult> => {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { members: { where: { userId: requesterId }, select: { role: true } } },
  });

  if (!channel) {
    return { status: 'not_found' };
  }
  if (channel.members[0]?.role !== ChannelRole.OWNER) {
    return { status: 'forbidden' };
  }

  const target = await prisma.channelMember.findUnique({
    where: { userId_channelId: { userId: targetUserId, channelId } },
  });
  if (!target) {
    return { status: 'target_not_found' };
  }
  if (target.role === ChannelRole.OWNER) {
    return { status: 'owner_protected' };
  }

  await prisma.channelMember.delete({ where: { id: target.id } });
  return { status: 'removed' };
};
