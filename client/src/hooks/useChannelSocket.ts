import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshTokens } from '../api/client';
import { getAccessToken } from '../api/token';
import { type ChannelMessage } from '../api/messages';

// Кадры протокола реального времени: сервер → клиент
export type ServerFrame =
  | { type: 'subscribed'; channelId: string }
  | { type: 'unsubscribed'; channelId: string }
  | { type: 'message'; message: ChannelMessage }
  | { type: 'message.deleted'; channelId: string; messageId: string }
  | { type: 'error'; message: string };

// Кадры протокола реального времени: клиент → сервер
export type ClientFrame =
  | { type: 'subscribe'; channelId: string }
  | { type: 'unsubscribe'; channelId: string }
  | { type: 'send'; channelId: string; content: string }
  | { type: 'delete'; messageId: string };

// Параметры подключения к ленте канала
interface UseChannelSocketOptions {
  /** Активный канал: подключение подписывается на его ленту */
  channelId: string | null;
  /** Обработчик нового сообщения из ленты */
  onMessage: (message: ChannelMessage) => void;
  /** Обработчик удаления сообщения из ленты */
  onDelete: (messageId: string) => void;
  /** Обработчик ошибки протокола (например, отклонённой отправки) */
  onError?: (text: string) => void;
}

// Управление соединением реального времени
export interface ChannelSocket {
  /** Отправка сообщения в активный канал (false — соединение не готово) */
  sendMessage: (content: string) => boolean;
  /** Запрос удаления сообщения (false — соединение не готово) */
  deleteMessage: (messageId: string) => boolean;
  /** Признак установленного соединения */
  isConnected: boolean;
}

// Код закрытия сервером при непройденной аутентификации (см. server realtime)
const AUTH_CLOSE_CODE = 4401;

// Экспоненциальная задержка переподключения с потолком
const BASE_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

// Адрес WebSocket-сервера текущего origin.
// Токен сессии передаётся query-параметром: браузерный WebSocket
// не умеет задавать заголовок Authorization при рукопожатии
export const buildSocketUrl = (token: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
};

// Проверка структуры кадра, полученного от сервера
const isServerFrame = (value: unknown): value is ServerFrame => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const frame = value as { type?: unknown; message?: unknown; messageId?: unknown };
  if (frame.type === 'message') {
    return typeof frame.message === 'object' && frame.message !== null;
  }
  if (frame.type === 'message.deleted') {
    return typeof frame.messageId === 'string' && frame.messageId.length > 0;
  }
  return frame.type === 'subscribed' || frame.type === 'unsubscribed' || frame.type === 'error';
};

// Разбор кадра сервера: null для некорректного JSON и неизвестных структур
export const parseServerFrame = (raw: unknown): ServerFrame | null => {
  if (typeof raw !== 'string') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isServerFrame(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

// Подключение к ленте канала с автоматическим восстановлением.
// Одно соединение на всё время жизни: смена канала переиспользует его,
// а обрыв связи переподключается с экспоненциальной задержкой.
export const useChannelSocket = (options: UseChannelSocketOptions): ChannelSocket => {
  const { channelId, onMessage, onDelete, onError } = options;
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  // Актуальные значения для замыканий событий сокета
  const channelRef = useRef(channelId);
  const onMessageRef = useRef(onMessage);
  const onDeleteRef = useRef(onDelete);
  const onErrorRef = useRef(onError);
  // Канал, на который подписано текущее соединение
  const subscribedRef = useRef<string | null>(null);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onDeleteRef.current = onDelete;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let attempts = 0;

    const openSocket = (): void => {
      const token = getAccessToken();
      if (!token || disposed) {
        return;
      }

      const socket = new WebSocket(buildSocketUrl(token));
      socketRef.current = socket;

      socket.onopen = (): void => {
        attempts = 0;
        setIsConnected(true);
        const channel = channelRef.current;
        subscribedRef.current = channel;
        if (channel) {
          socket.send(JSON.stringify({ type: 'subscribe', channelId: channel }));
        }
      };

      socket.onmessage = (event): void => {
        const frame = parseServerFrame(event.data);
        if (frame?.type === 'message') {
          onMessageRef.current(frame.message);
        }
        if (frame?.type === 'message.deleted') {
          onDeleteRef.current(frame.messageId);
        }
        if (frame?.type === 'error') {
          onErrorRef.current?.(frame.message);
        }
      };

      socket.onclose = (event): void => {
        setIsConnected(false);
        socketRef.current = null;
        if (!disposed) {
          scheduleReconnect(event.code);
        }
      };
    };

    // Восстановление соединения: при закрытии по токену сессия
    // сначала обновляется, иначе сервер снова отклонит подключение
    const scheduleReconnect = (closeCode: number): void => {
      const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** attempts, MAX_RECONNECT_DELAY);
      attempts += 1;

      reconnectTimer = window.setTimeout(() => {
        if (closeCode === AUTH_CLOSE_CODE) {
          refreshTokens()
            .then(() => openSocket())
            .catch(() => undefined);
          return;
        }
        openSocket();
      }, delay);
    };

    openSocket();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, []);

  // Смена активного канала: отписка от прежнего и подписка на новый
  useEffect(() => {
    const socket = socketRef.current;
    const previous = subscribedRef.current;
    channelRef.current = channelId;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      subscribedRef.current = channelId;
      return;
    }

    if (previous && previous !== channelId) {
      socket.send(JSON.stringify({ type: 'unsubscribe', channelId: previous }));
    }
    if (channelId && channelId !== previous) {
      socket.send(JSON.stringify({ type: 'subscribe', channelId }));
    }
    subscribedRef.current = channelId;
  }, [channelId]);

  // Отправка сообщения в активный канал через открытое соединение
  const sendMessage = useCallback((content: string): boolean => {
    const socket = socketRef.current;
    const channel = channelRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !channel) {
      return false;
    }
    socket.send(JSON.stringify({ type: 'send', channelId: channel, content }));
    return true;
  }, []);

  // Запрос удаления сообщения: права проверяет сервер, подтверждение
  // приходит кадром message.deleted и удаляет запись из ленты
  const deleteMessage = useCallback((messageId: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify({ type: 'delete', messageId }));
    return true;
  }, []);

  return { sendMessage, deleteMessage, isConnected };
};
