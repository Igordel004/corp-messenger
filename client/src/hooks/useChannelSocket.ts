import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshTokens } from '../api/client';
import { getAccessToken } from '../api/token';
import { type ChannelMessage } from '../api/messages';

export type ServerFrame =
  | { type: 'subscribed'; channelId: string }
  | { type: 'unsubscribed'; channelId: string }
  | { type: 'message'; message: ChannelMessage }
  | { type: 'message.deleted'; channelId: string; messageId: string }
  | { type: 'error'; message: string };

export type ClientFrame =
  | { type: 'subscribe'; channelId: string }
  | { type: 'unsubscribe'; channelId: string }
  | { type: 'send'; channelId: string; content: string }
  | { type: 'delete'; messageId: string };

interface UseChannelSocketOptions {
  channelId: string | null;
  onMessage: (message: ChannelMessage) => void;
  onDelete: (messageId: string) => void;
  onError?: (text: string) => void;
}

export interface ChannelSocket {
  sendMessage: (content: string) => boolean;
  deleteMessage: (messageId: string) => boolean;
  isConnected: boolean;
}

const AUTH_CLOSE_CODE = 4401;

const BASE_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

export const buildSocketUrl = (token: string): string => {
  const apiBase = import.meta.env['VITE_API_URL'] as string | undefined;
  const socketBase = apiBase
    ? `${apiBase.replace(/^http/, 'ws').replace(/\/api\/?$/, '')}/ws`
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
  return `${socketBase}?token=${encodeURIComponent(token)}`;
};

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

export const useChannelSocket = (options: UseChannelSocketOptions): ChannelSocket => {
  const { channelId, onMessage, onDelete, onError } = options;
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const channelRef = useRef(channelId);
  const onMessageRef = useRef(onMessage);
  const onDeleteRef = useRef(onDelete);
  const onErrorRef = useRef(onError);
  const subscribedRef = useRef<string | null>(null);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onDeleteRef.current = onDelete;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let disposed = false;
    let connectTimer: number | null = null;
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
        if (socketRef.current !== socket) {
          return;
        }
        attempts = 0;
        setIsConnected(true);
        const channel = channelRef.current;
        subscribedRef.current = channel;
        if (channel) {
          socket.send(JSON.stringify({ type: 'subscribe', channelId: channel }));
        }
      };

      socket.onmessage = (event): void => {
        if (socketRef.current !== socket) {
          return;
        }
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
        if (socketRef.current !== socket) {
          return;
        }
        setIsConnected(false);
        socketRef.current = null;
        if (!disposed) {
          scheduleReconnect(event.code);
        }
      };
    };

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

    connectTimer = window.setTimeout(() => {
      connectTimer = null;
      openSocket();
    }, 0);

    return () => {
      disposed = true;
      if (connectTimer !== null) {
        window.clearTimeout(connectTimer);
      }
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, []);

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

  const sendMessage = useCallback((content: string): boolean => {
    const socket = socketRef.current;
    const channel = channelRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !channel) {
      return false;
    }
    socket.send(JSON.stringify({ type: 'send', channelId: channel, content }));
    return true;
  }, []);

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
