import { type PrismaClient } from '../generated/prisma/client';
import { ChannelRole } from '../generated/prisma/enums';

// Максимальная длина текста сообщения в символах
export const MAX_MESSAGE_LENGTH = 2000;

// Сообщение вместе с данными автора: имя и время отображаются в ленте
export interface MessageInfo {
  id: string;
  channelId: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: Date;
}

// Результат сохранения сообщения
export type CreateMessageResult =
  | { status: 'sent'; message: MessageInfo }
  | { status: 'invalid' }
  | { status: 'not_found' }
  | { status: 'forbidden' };

// Результат запроса ленты сообщений канала
export type MessageListResult =
  { status: 'ok'; messages: MessageInfo[] } | { status: 'not_found' } | { status: 'forbidden' };

// Приведение записи Prisma с данными автора к транспортному виду сообщения
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

// Сохранение сообщения участника канала.
// Текст обрезается по краям и проверяется на непустоту и длину;
// писать может только участник существующего канала — проверка
// выполняется перед записью, чтобы исключённый участник не мог
// отправлять сообщения после потери доступа.
export const createMessage = async (
  prisma: PrismaClient,
  input: { channelId: string; authorId: string; content: string },
): Promise<CreateMessageResult> => {
  const content = input.content.trim();
  if (content.length === 0 || content.length > MAX_MESSAGE_LENGTH) {
    return { status: 'invalid' };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: input.channelId },
    select: { id: true },
  });
  if (!channel) {
    return { status: 'not_found' };
  }

  const membership = await prisma.channelMember.findUnique({
    where: { userId_channelId: { userId: input.authorId, channelId: input.channelId } },
    select: { userId: true },
  });
  if (!membership) {
    return { status: 'forbidden' };
  }

  const created = await prisma.message.create({
    data: { content, authorId: input.authorId, channelId: input.channelId },
    include: { author: { select: { fullName: true } } },
  });

  return { status: 'sent', message: toMessageInfo(created) };
};

// Лента сообщений канала: доступна только участникам канала.
// Сообщения упорядочены хронологически от старых к новым;
// id добавлен вторым ключом, чтобы порядок сообщений с одинаковой
// меткой времени оставался стабильным между запросами.
export const listMessages = async (
  prisma: PrismaClient,
  channelId: string,
  requesterId: string,
): Promise<MessageListResult> => {
  const requester = await prisma.channelMember.findUnique({
    where: { userId_channelId: { userId: requesterId, channelId } },
    select: { userId: true },
  });

  if (!requester) {
    // Разделяем «канала нет» и «нет доступа», чтобы не раскрывать существование
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });
    return channel ? { status: 'forbidden' } : { status: 'not_found' };
  }

  const messages = await prisma.message.findMany({
    where: { channelId },
    include: { author: { select: { fullName: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return { status: 'ok', messages: messages.map(toMessageInfo) };
};

// Идентификаторы участников канала — фильтр получателей рассылки.
// Состав читается при каждой отправке, поэтому участник, исключённый
// после подписки на канал, новых сообщений не получает
export const listChannelMemberIds = async (
  prisma: PrismaClient,
  channelId: string,
): Promise<string[]> => {
  const members = await prisma.channelMember.findMany({
    where: { channelId },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
};

// Результат удаления сообщения.
// deleted возвращает канал для рассылки уведомления об удалении
export type DeleteMessageResult =
  | { status: 'deleted'; messageId: string; channelId: string }
  | { status: 'not_found' }
  | { status: 'forbidden' };

// Удаление сообщения с контролем прав доступа.
// MEMBER удаляет только свои сообщения, MODERATOR и OWNER — любые
// сообщения канала; инициатор обязан состоять в канале на момент
// удаления, поэтому исключённый участник теряет право удалять.
// Запись удаляется из БД физически — критерий готовности задачи.
export const deleteMessage = async (
  prisma: PrismaClient,
  input: { messageId: string; initiatorId: string },
): Promise<DeleteMessageResult> => {
  const message = await prisma.message.findUnique({
    where: { id: input.messageId },
    select: { id: true, channelId: true, authorId: true },
  });
  if (!message) {
    return { status: 'not_found' };
  }

  const membership = await prisma.channelMember.findUnique({
    where: { userId_channelId: { userId: input.initiatorId, channelId: message.channelId } },
    select: { role: true },
  });
  if (!membership) {
    return { status: 'forbidden' };
  }

  // Разграничение прав: авторство или модераторская роль
  const isAuthor = message.authorId === input.initiatorId;
  const canModerate =
    membership.role === ChannelRole.OWNER || membership.role === ChannelRole.MODERATOR;
  if (!isAuthor && !canModerate) {
    return { status: 'forbidden' };
  }

  await prisma.message.delete({ where: { id: message.id } });

  return { status: 'deleted', messageId: message.id, channelId: message.channelId };
};
