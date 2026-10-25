import { type PrismaClient } from '../generated/prisma/client';
import { ChannelRole } from '../generated/prisma/enums';

export const MAX_MESSAGE_LENGTH = 2000;

export interface MessageInfo {
  id: string;
  channelId: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: Date;
}

export type CreateMessageResult =
  | { status: 'sent'; message: MessageInfo }
  | { status: 'invalid' }
  | { status: 'not_found' }
  | { status: 'forbidden' };

export type MessageListResult =
  { status: 'ok'; messages: MessageInfo[] } | { status: 'not_found' } | { status: 'forbidden' };

export type DeleteMessageResult =
  | { status: 'deleted'; messageId: string; channelId: string }
  | { status: 'not_found' }
  | { status: 'forbidden' };

// События сервиса сообщений: шлюз реального времени подписывается
// на них и рассылает активным пользователям (In-Memory Event)
export type MessageEvent =
  | { type: 'message'; message: MessageInfo }
  | { type: 'message.deleted'; channelId: string; messageId: string };

export type MessageEventListener = (event: MessageEvent) => void | Promise<void>;

const toMessageInfo = (message: {
  id: string;
  channelId: string;
  content: string;
  authorId: string;
  createdAt: Date;
  author: { fullName: string };
}): MessageInfo => ({
  id: message.id,
  channelId: message.channelId,
  content: message.content,
  authorId: message.authorId,
  authorName: message.author.fullName,
  createdAt: message.createdAt,
});

export class MessageService {
  private listener: MessageEventListener | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  onEvent(listener: MessageEventListener): void {
    this.listener = listener;
  }

  async isChannelMember(channelId: string, userId: string): Promise<boolean> {
    const membership = await this.prisma.channelMember.findUnique({
      where: { userId_channelId: { userId, channelId } },
      select: { userId: true },
    });
    return membership !== null;
  }

  async create(input: {
    channelId: string;
    authorId: string;
    content: string;
  }): Promise<CreateMessageResult> {
    const content = input.content.trim();
    if (content.length === 0 || content.length > MAX_MESSAGE_LENGTH) {
      return { status: 'invalid' };
    }

    const channel = await this.prisma.channel.findUnique({
      where: { id: input.channelId },
      select: { id: true },
    });
    if (!channel) {
      return { status: 'not_found' };
    }

    const membership = await this.prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: input.authorId, channelId: input.channelId } },
      select: { userId: true },
    });
    if (!membership) {
      return { status: 'forbidden' };
    }

    const created = await this.prisma.message.create({
      data: { content, authorId: input.authorId, channelId: input.channelId },
      include: { author: { select: { fullName: true } } },
    });

    const message = toMessageInfo(created);
    await this.listener?.({ type: 'message', message });
    return { status: 'sent', message };
  }

  async list(channelId: string, requesterId: string): Promise<MessageListResult> {
    const requester = await this.prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: requesterId, channelId } },
      select: { userId: true },
    });

    if (!requester) {
      // Разделяем «канала нет» и «нет доступа», чтобы не раскрывать существование
      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { id: true },
      });
      return channel ? { status: 'forbidden' } : { status: 'not_found' };
    }

    const messages = await this.prisma.message.findMany({
      where: { channelId },
      include: { author: { select: { fullName: true } } },
      // id — стабилизатор порядка для сообщений с одинаковой меткой времени
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return { status: 'ok', messages: messages.map(toMessageInfo) };
  }

  // Состав читается при каждом вызове: исключённый участник
  // перестаёт получать рассылку даже с открытой подпиской
  async listChannelMemberIds(channelId: string): Promise<string[]> {
    const members = await this.prisma.channelMember.findMany({
      where: { channelId },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  async delete(input: { messageId: string; initiatorId: string }): Promise<DeleteMessageResult> {
    const message = await this.prisma.message.findUnique({
      where: { id: input.messageId },
      select: { id: true, channelId: true, authorId: true },
    });
    if (!message) {
      return { status: 'not_found' };
    }

    const membership = await this.prisma.channelMember.findUnique({
      where: {
        userId_channelId: { userId: input.initiatorId, channelId: message.channelId },
      },
      select: { role: true },
    });
    if (!membership) {
      return { status: 'forbidden' };
    }

    // MEMBER удаляет только свои сообщения, MODERATOR и OWNER — любые
    const isAuthor = message.authorId === input.initiatorId;
    const canModerate =
      membership.role === ChannelRole.OWNER || membership.role === ChannelRole.MODERATOR;
    if (!isAuthor && !canModerate) {
      return { status: 'forbidden' };
    }

    await this.prisma.message.delete({ where: { id: message.id } });

    await this.listener?.({
      type: 'message.deleted',
      channelId: message.channelId,
      messageId: message.id,
    });
    return { status: 'deleted', messageId: message.id, channelId: message.channelId };
  }
}
