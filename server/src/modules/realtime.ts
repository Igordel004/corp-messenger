import { type IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { type PrismaClient } from '../generated/prisma/client';
import { verifyAccessToken } from '../utils/token';
import {
  createMessage,
  listChannelMemberIds,
  MAX_MESSAGE_LENGTH,
  type MessageInfo,
} from './messages';

// Код закрытия соединения при непройденной аутентификации
export const AUTH_CLOSE_CODE = 4401;

// Кадры протокола реального времени: клиент → сервер
export type ClientFrame =
  | { type: 'subscribe'; channelId: string }
  | { type: 'unsubscribe'; channelId: string }
  | { type: 'send'; channelId: string; content: string };

// Кадры протокола реального времени: сервер → клиент
export type ServerFrame =
  | { type: 'subscribed'; channelId: string }
  | { type: 'unsubscribed'; channelId: string }
  | { type: 'message'; message: MessageInfo }
  | { type: 'error'; message: string };

// Тексты ошибок по статусам сохранения сообщения
const SEND_ERRORS: Record<'invalid' | 'not_found' | 'forbidden', string> = {
  invalid: `Сообщение не может быть пустым или длиннее ${MAX_MESSAGE_LENGTH} символов`,
  not_found: 'Канал не найден',
  forbidden: 'Отправка доступна только участникам канала',
};

// Состояние подключения: пользователь и подписанные каналы
interface ConnectionState {
  userId: string;
  channels: Set<string>;
}

// Управление подключениями реального времени и рассылкой сообщений
export interface RealtimeHub {
  // Обработка нового WebSocket-подключения
  handleConnection: (socket: WebSocket, request: IncomingMessage) => void;
  // Рассылка сохранённого сообщения подписчикам канала
  broadcast: (message: MessageInfo) => Promise<void>;
}

// Разбор кадра, полученного от клиента.
// Возвращает null для некорректного JSON, не-объектов,
// неизвестных типов кадров и отсутствующих обязательных полей
export const parseClientFrame = (raw: string): ClientFrame | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const frame = parsed as { type?: unknown; channelId?: unknown; content?: unknown };
  if (typeof frame.channelId !== 'string' || frame.channelId.length === 0) {
    return null;
  }

  switch (frame.type) {
    case 'subscribe':
      return { type: 'subscribe', channelId: frame.channelId };
    case 'unsubscribe':
      return { type: 'unsubscribe', channelId: frame.channelId };
    case 'send':
      return typeof frame.content === 'string'
        ? { type: 'send', channelId: frame.channelId, content: frame.content }
        : null;
    default:
      return null;
  }
};

// Токен сессии передаётся query-параметром: браузерный WebSocket
// не умеет задавать заголовок Authorization при рукопожатии
const extractToken = (url: string): string | null => {
  return new URL(url, 'http://localhost').searchParams.get('token');
};

// Идентификатор пользователя из токена сессии запроса.
// Подключение без валидного access-токена не обслуживается
const authenticate = (request: IncomingMessage): string | null => {
  const token = extractToken(request.url ?? '');
  if (token === null) {
    return null;
  }
  try {
    return verifyAccessToken(token).sub;
  } catch {
    return null;
  }
};

// Хаб реального времени: одно подключение — один пользователь,
// подписки на каналы ограничивают получаемую рассылку
export const createRealtimeHub = (prisma: PrismaClient): RealtimeHub => {
  const connections = new Map<WebSocket, ConnectionState>();

  const sendFrame = (socket: WebSocket, frame: ServerFrame): void => {
    socket.send(JSON.stringify(frame));
  };

  const broadcast = async (message: MessageInfo): Promise<void> => {
    // Состав канала читается на каждую отправку: исключённый участник
    // перестаёт получать сообщения даже при открытой подписке
    const memberIds = new Set(await listChannelMemberIds(prisma, message.channelId));
    const frame: ServerFrame = { type: 'message', message };

    for (const [socket, state] of connections) {
      if (state.channels.has(message.channelId) && memberIds.has(state.userId)) {
        sendFrame(socket, frame);
      }
    }
  };

  const handleSubscribe = async (
    socket: WebSocket,
    state: ConnectionState,
    channelId: string,
  ): Promise<void> => {
    const membership = await prisma.channelMember.findUnique({
      where: { userId_channelId: { userId: state.userId, channelId } },
      select: { userId: true },
    });

    if (membership === null) {
      sendFrame(socket, {
        type: 'error',
        message: 'Подписка доступна только участникам канала',
      });
      return;
    }

    state.channels.add(channelId);
    sendFrame(socket, { type: 'subscribed', channelId });
  };

  const handleSend = async (
    socket: WebSocket,
    state: ConnectionState,
    frame: Extract<ClientFrame, { type: 'send' }>,
  ): Promise<void> => {
    const result = await createMessage(prisma, {
      channelId: frame.channelId,
      authorId: state.userId,
      content: frame.content,
    });

    if (result.status !== 'sent') {
      sendFrame(socket, { type: 'error', message: SEND_ERRORS[result.status] });
      return;
    }

    await broadcast(result.message);
  };

  const processFrame = async (
    socket: WebSocket,
    state: ConnectionState,
    raw: string,
  ): Promise<void> => {
    const frame = parseClientFrame(raw);
    if (frame === null) {
      sendFrame(socket, { type: 'error', message: 'Некорректный формат кадра' });
      return;
    }

    if (frame.type === 'subscribe') {
      await handleSubscribe(socket, state, frame.channelId);
      return;
    }

    if (frame.type === 'unsubscribe') {
      state.channels.delete(frame.channelId);
      sendFrame(socket, { type: 'unsubscribed', channelId: frame.channelId });
      return;
    }

    await handleSend(socket, state, frame);
  };

  const handleConnection = (socket: WebSocket, request: IncomingMessage): void => {
    const userId = authenticate(request);
    if (userId === null) {
      socket.close(AUTH_CLOSE_CODE, 'Невалидный или истёкший токен');
      return;
    }

    const state: ConnectionState = { userId, channels: new Set() };
    connections.set(socket, state);

    socket.on('message', async (data) => {
      await processFrame(socket, state, data.toString());
    });

    socket.on('close', () => {
      connections.delete(socket);
    });
  };

  return { handleConnection, broadcast };
};
