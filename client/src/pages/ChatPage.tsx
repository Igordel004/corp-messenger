import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import { type LayoutOutletContext } from '../components/AppLayout';
import { MembersPanel } from '../components/MembersPanel';
import { MessageBubble } from '../components/MessageBubble';
import { MessageComposer } from '../components/MessageComposer';
import { usePanelResize } from '../hooks/usePanelResize';
import { useChannelSocket } from '../hooks/useChannelSocket';
import { fetchChannelMessages, type ChannelMessage } from '../api/messages';
import { type ChannelRole } from '../api/channels';
import { getApiErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';

const TYPE_LABELS: Record<'PUBLIC' | 'PRIVATE', string> = {
  PUBLIC: 'Публичный канал',
  PRIVATE: 'Приватный канал',
};

const sortChronologically = (list: ChannelMessage[]): ChannelMessage[] =>
  [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const canDeleteMessage = (
  message: ChannelMessage,
  userId: string | undefined,
  role: ChannelRole,
): boolean => {
  if (message.authorId === userId) {
    return true;
  }
  return role === 'OWNER' || role === 'MODERATOR';
};

export const ChatPage = () => {
  const { activeChannel } = useOutletContext<LayoutOutletContext>();
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const messagesRef = useRef<HTMLDivElement | null>(null);

  const channelId = activeChannel?.id ?? null;

  const handleIncomingMessage = useCallback(
    (message: ChannelMessage) => {
      if (message.channelId !== channelId) {
        return;
      }
      setMessages((current) => {
        if (current.some((item) => item.id === message.id)) {
          return current;
        }
        return sortChronologically([...current, message]);
      });
      setError(null);
    },
    [channelId],
  );

  const handleSocketError = useCallback((text: string) => {
    setError(text);
  }, []);

  const handleDeletedMessage = useCallback((messageId: string) => {
    setMessages((current) => current.filter((item) => item.id !== messageId));
  }, []);

  const { sendMessage, deleteMessage } = useChannelSocket({
    channelId,
    onMessage: handleIncomingMessage,
    onDelete: handleDeletedMessage,
    onError: handleSocketError,
  });

  const handleDeleteRequest = useCallback(
    (messageId: string) => {
      const sent = deleteMessage(messageId);
      if (!sent) {
        setError('Нет соединения с сервером. Попробуйте позже.');
      }
    },
    [deleteMessage],
  );

  const { width: membersWidth, handleMouseDown: onMembersResizeStart } = usePanelResize(
    280,
    220,
    420,
    { invert: true },
  );

  useEffect(() => {
    if (!channelId) {
      return;
    }
    let cancelled = false;

    setMessages([]);
    setIsLoading(true);
    setError(null);

    fetchChannelMessages(channelId)
      .then((history) => {
        if (!cancelled) {
          setMessages((current) => {
            const known = new Set(history.map((item) => item.id));
            const received = current.filter((item) => !known.has(item.id));
            return sortChronologically([...history, ...received]);
          });
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(getApiErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, channelId]);

  const handleSend = useCallback(
    (content: string): boolean => {
      const sent = sendMessage(content);
      if (!sent) {
        setError('Нет соединения с сервером. Попробуйте позже.');
      }
      return sent;
    },
    [sendMessage],
  );

  if (!activeChannel) {
    return (
      <div className="chat__placeholder">
        <div className="chat__placeholder-icon" aria-hidden="true">
          #
        </div>
        <p className="chat__placeholder-title">Выберите канал</p>
        <p className="chat__placeholder-text">
          Выберите канал в списке слева, создайте новый или присоединитесь через каталог.
        </p>
      </div>
    );
  }

  return (
    <div className="chat-area">
      <section className="chat">
        <header className="chat__header">
          <span className="channel-item__avatar" aria-hidden="true">
            {activeChannel.name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="chat__header-body">
            <h1 className="chat__title">{activeChannel.name}</h1>
            <p className="chat__subtitle">{TYPE_LABELS[activeChannel.type]}</p>
          </div>
        </header>

        <div className="chat__messages" ref={messagesRef}>
          {isLoading && <p className="sidebar__empty">Загрузка...</p>}
          {error && <p className="form-error">{error}</p>}
          {!isLoading && !error && messages.length === 0 && (
            <p className="sidebar__empty">Сообщений пока нет</p>
          )}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isOutgoing={message.authorId === user?.id}
              canDelete={canDeleteMessage(message, user?.id, activeChannel.role)}
              onDelete={handleDeleteRequest}
            />
          ))}
        </div>

        <MessageComposer onSend={handleSend} />
      </section>

      <div
        className="resize-handle resize-handle--left"
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину панели участников"
        onMouseDown={onMembersResizeStart}
      />

      <MembersPanel
        key={activeChannel.id}
        channelId={activeChannel.id}
        myRole={activeChannel.role}
        width={membersWidth}
      />
    </div>
  );
};
