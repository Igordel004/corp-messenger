import { type IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { verifyAccessToken } from '../services/auth';
import {
  type MessageService,
  type MessageEvent,
  MAX_MESSAGE_LENGTH,
  type MessageInfo,
} from '../services/message';

export const AUTH_CLOSE_CODE = 4401;

export type ClientFrame =
  | { type: 'subscribe'; channelId: string }
  | { type: 'unsubscribe'; channelId: string }
  | { type: 'send'; channelId: string; content: string }
  | { type: 'delete'; messageId: string };

export type ServerFrame =
  | { type: 'subscribed'; channelId: string }
  | { type: 'unsubscribed'; channelId: string }
  | { type: 'message'; message: MessageInfo }
  | { type: 'message.deleted'; channelId: string; messageId: string }
  | { type: 'error'; message: string };

const SEND_ERRORS: Record<'invalid' | 'not_found' | 'forbidden', string> = {
  invalid: `Сообщение не может быть пустым или длиннее ${MAX_MESSAGE_LENGTH} символов`,
  not_found: 'Канал не найден',
  forbidden: 'Отправка доступна только участникам канала',
};

const DELETE_ERRORS: Record<'not_found' | 'forbidden', string> = {
  not_found: 'Сообщение не найдено',
  forbidden: 'Удалять сообщения может только автор, модератор или владелец',
};

interface ConnectionState {
  userId: string;
  channels: Set<string>;
}

export interface RealtimeHub {
  handleConnection: (socket: WebSocket, request: IncomingMessage) => void;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const asFrameRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
};

const toChannelFrame = (
  type: 'subscribe' | 'unsubscribe',
  frame: Record<string, unknown>,
): ClientFrame | null => {
  return isNonEmptyString(frame.channelId) ? { type, channelId: frame.channelId } : null;
};

const toSendFrame = (frame: Record<string, unknown>): ClientFrame | null => {
  return isNonEmptyString(frame.channelId) && typeof frame.content === 'string'
    ? { type: 'send', channelId: frame.channelId, content: frame.content }
    : null;
};

const toDeleteFrame = (frame: Record<string, unknown>): ClientFrame | null => {
  return isNonEmptyString(frame.messageId) ? { type: 'delete', messageId: frame.messageId } : null;
};

export const parseClientFrame = (raw: string): ClientFrame | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const frame = asFrameRecord(parsed);
  if (frame === null) {
    return null;
  }

  switch (frame.type) {
    case 'subscribe':
      return toChannelFrame('subscribe', frame);
    case 'unsubscribe':
      return toChannelFrame('unsubscribe', frame);
    case 'send':
      return toSendFrame(frame);
    case 'delete':
      return toDeleteFrame(frame);
    default:
      return null;
  }
};

// Токен сессии передаётся query-параметром: браузерный WebSocket
// не умеет задавать заголовок Authorization при рукопожатии
const extractToken = (url: string): string | null => {
  return new URL(url, 'http://localhost').searchParams.get('token');
};

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

export const createRealtimeHub = (messageService: MessageService): RealtimeHub => {
  const connections = new Map<WebSocket, ConnectionState>();

  const sendFrame = (socket: WebSocket, frame: ServerFrame): void => {
    socket.send(JSON.stringify(frame));
  };

  const broadcastToChannel = async (channelId: string, frame: ServerFrame): Promise<void> => {
    const memberIds = new Set(await messageService.listChannelMemberIds(channelId));

    for (const [socket, state] of connections) {
      if (state.channels.has(channelId) && memberIds.has(state.userId)) {
        sendFrame(socket, frame);
      }
    }
  };

  const onServiceEvent = async (event: MessageEvent): Promise<void> => {
    if (event.type === 'message') {
      await broadcastToChannel(event.message.channelId, {
        type: 'message',
        message: event.message,
      });
      return;
    }
    await broadcastToChannel(event.channelId, {
      type: 'message.deleted',
      channelId: event.channelId,
      messageId: event.messageId,
    });
  };

  messageService.onEvent(onServiceEvent);

  const handleSubscribe = async (
    socket: WebSocket,
    state: ConnectionState,
    channelId: string,
  ): Promise<void> => {
    const isMember = await messageService.isChannelMember(channelId, state.userId);

    if (!isMember) {
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
    const result = await messageService.create({
      channelId: frame.channelId,
      authorId: state.userId,
      content: frame.content,
    });

    if (result.status !== 'sent') {
      sendFrame(socket, { type: 'error', message: SEND_ERRORS[result.status] });
    }
  };

  const handleDelete = async (
    socket: WebSocket,
    state: ConnectionState,
    frame: Extract<ClientFrame, { type: 'delete' }>,
  ): Promise<void> => {
    const result = await messageService.delete({
      messageId: frame.messageId,
      initiatorId: state.userId,
    });

    if (result.status !== 'deleted') {
      sendFrame(socket, { type: 'error', message: DELETE_ERRORS[result.status] });
    }
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

    if (frame.type === 'delete') {
      await handleDelete(socket, state, frame);
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

  return { handleConnection };
};
