import { type PrismaClient } from '../generated/prisma/client';
import { ChannelType, ChannelRole } from '../generated/prisma/enums';

export interface CreateChannelInput {
  name: string;
  type: ChannelType;
  creatorId: string;
}

export interface CreatedChannel {
  id: string;
  name: string;
  type: ChannelType;
  createdAt: Date;
}

export interface UserChannel {
  id: string;
  name: string;
  type: ChannelType;
  role: ChannelRole;
  joinedAt: Date;
}

export interface CatalogChannel {
  id: string;
  name: string;
  type: ChannelType;
  isMember: boolean;
}

export type JoinChannelResult =
  | { status: 'joined'; channel: { id: string; name: string; type: ChannelType } }
  | { status: 'not_found' }
  | { status: 'private' }
  | { status: 'already_member' };

export interface ChannelMemberInfo {
  userId: string;
  fullName: string;
  email: string;
  role: ChannelRole;
  joinedAt: Date;
}

export type MemberListResult =
  | { status: 'ok'; members: ChannelMemberInfo[] }
  | { status: 'not_found' }
  | { status: 'forbidden' };

export type AddMemberResult =
  | {
      status: 'added';
      member: { userId: string; fullName: string; email: string; role: ChannelRole };
    }
  | { status: 'not_found' }
  | { status: 'user_not_found' }
  | { status: 'forbidden' }
  | { status: 'already_member' };

export type RemoveMemberResult =
  | { status: 'removed' }
  | { status: 'left' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'target_not_found' }
  | { status: 'owner_protected' };

export type ChangeRoleResult =
  | { status: 'changed'; role: ChannelRole }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'target_not_found' }
  | { status: 'owner_protected' }
  | { status: 'role_unchanged' };

// Уникальный индекс (user, channel) превращает гонку параллельных
// вступлений в отказ «уже участник» вместо дубля
const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string }).code === 'P2002';

export class ChannelService {
  constructor(private readonly prisma: PrismaClient) {}

  async createWithOwner(input: CreateChannelInput): Promise<CreatedChannel> {
    return this.prisma.$transaction(async (tx) => {
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
  }

  async listUserChannels(userId: string): Promise<UserChannel[]> {
    const memberships = await this.prisma.channelMember.findMany({
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
  }

  // Приватные каналы без участия пользователя скрыты — их
  // существование для посторонних не раскрывается
  async listCatalog(userId: string): Promise<CatalogChannel[]> {
    const channels = await this.prisma.channel.findMany({
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
  }

  async join(channelId: string, userId: string): Promise<JoinChannelResult> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { members: { where: { userId }, select: { id: true } } },
    });

    if (!channel) {
      return { status: 'not_found' };
    }
    if (channel.members.length > 0) {
      return { status: 'already_member' };
    }
    if (channel.type === ChannelType.PRIVATE) {
      return { status: 'private' };
    }

    try {
      await this.prisma.channelMember.create({
        data: { channelId, userId, role: ChannelRole.MEMBER },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { status: 'already_member' };
      }
      throw error;
    }

    return {
      status: 'joined',
      channel: { id: channel.id, name: channel.name, type: channel.type },
    };
  }

  async listMembers(channelId: string, requesterId: string): Promise<MemberListResult> {
    const requester = await this.prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: requesterId, channelId } },
    });

    if (!requester) {
      // Разделяем «канала нет» и «нет доступа», чтобы не раскрывать существование
      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { id: true },
      });
      return channel ? { status: 'forbidden' } : { status: 'not_found' };
    }

    const members = await this.prisma.channelMember.findMany({
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
  }

  async addMember(
    channelId: string,
    requesterId: string,
    inviteeEmail: string,
  ): Promise<AddMemberResult> {
    const channel = await this.prisma.channel.findUnique({
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

    const invitee = await this.prisma.user.findUnique({ where: { email: inviteeEmail } });
    if (!invitee) {
      return { status: 'user_not_found' };
    }

    const existing = await this.prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: invitee.id, channelId } },
    });
    if (existing) {
      return { status: 'already_member' };
    }

    try {
      await this.prisma.channelMember.create({
        data: { channelId, userId: invitee.id, role: ChannelRole.MEMBER },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
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
  }

  async removeMember(
    channelId: string,
    requesterId: string,
    targetUserId: string,
  ): Promise<RemoveMemberResult> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { members: { where: { userId: requesterId }, select: { role: true } } },
    });

    if (!channel) {
      return { status: 'not_found' };
    }

    const requesterRole = channel.members[0]?.role;

    // Любой участник может выйти сам; исключать других — только OWNER
    if (requesterId === targetUserId) {
      if (requesterRole === ChannelRole.OWNER) {
        return { status: 'owner_protected' };
      }
      if (requesterRole === undefined) {
        return { status: 'forbidden' };
      }
    } else if (requesterRole !== ChannelRole.OWNER) {
      return { status: 'forbidden' };
    }

    const target = await this.prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: targetUserId, channelId } },
    });
    if (!target) {
      return { status: 'target_not_found' };
    }
    if (target.role === ChannelRole.OWNER) {
      return { status: 'owner_protected' };
    }

    await this.prisma.channelMember.delete({ where: { id: target.id } });
    return { status: requesterId === targetUserId ? 'left' : 'removed' };
  }

  // Роль OWNER неизменяема: переключение доступно строго между
  // MEMBER и MODERATOR, и только владелец канала
  async changeMemberRole(
    channelId: string,
    requesterId: string,
    targetUserId: string,
    newRole: ChannelRole,
  ): Promise<ChangeRoleResult> {
    if (newRole !== ChannelRole.MEMBER && newRole !== ChannelRole.MODERATOR) {
      return { status: 'forbidden' };
    }

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { members: { where: { userId: requesterId }, select: { role: true } } },
    });

    if (!channel) {
      return { status: 'not_found' };
    }
    if (channel.members[0]?.role !== ChannelRole.OWNER) {
      return { status: 'forbidden' };
    }

    const target = await this.prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: targetUserId, channelId } },
    });
    if (!target) {
      return { status: 'target_not_found' };
    }
    if (target.role === ChannelRole.OWNER) {
      return { status: 'owner_protected' };
    }
    if (target.role === newRole) {
      return { status: 'role_unchanged' };
    }

    await this.prisma.channelMember.update({
      where: { id: target.id },
      data: { role: newRole },
    });
    return { status: 'changed', role: newRole };
  }
}
