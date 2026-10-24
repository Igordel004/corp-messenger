// Чат активного канала: история сообщений загружается по REST,
// новые сообщения приходят в реальном времени по WebSocket.
// Каждое сообщение показывает имя автора, дату, время и текст.

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

// Подпись типа приватности в шапке чата
const TYPE_LABELS: Record<'PUBLIC' | 'PRIVATE', string> = {
  PUBLIC: 'Публичный канал',
  PRIVATE: 'Приватный канал',
};

// Хронологическая упорядоченность ленты: ISO-строки дат сравнимы
// лексикографически, поэтому сортировка детерминирована
const sortChronologically = (list: ChannelMessage[]): ChannelMessage[] =>
  [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

// Право удаления сообщения в канале.
// MEMBER удаляет только свои сообщения, MODERATOR и OWNER — любые;
// проверка дублирует серверную и управляет только видимостью кнопки
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

// Окно чата: лента сообщений, поле ввода и панель участников
export const ChatPage = () => {
  const { activeChannel } = useOutletContext<LayoutOutletContext>();
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Контейнер ленты: прокрутка к последнему сообщению
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const channelId = activeChannel?.id ?? null;

  // Новое сообщение из WebSocket: чужие каналы игнорируются,
  // дубликаты отбрасываются по id, порядок восстанавливается
  // хронологической сортировкой
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

  // Ошибка протокола (например, отклонённая отправка)
  const handleSocketError = useCallback((text: string) => {
    setError(text);
  }, []);

  // Удаление сообщения из ленты по подтверждению сервера
  const handleDeletedMessage = useCallback((messageId: string) => {
    setMessages((current) => current.filter((item) => item.id !== messageId));
  }, []);

  const { sendMessage, deleteMessage } = useChannelSocket({
    channelId,
    onMessage: handleIncomingMessage,
    onDelete: handleDeletedMessage,
    onError: handleSocketError,
  });

  // Запрос удаления сообщения: подтверждение придёт кадром
  // message.deleted и удалит запись из ленты у всех участников
  const handleDeleteRequest = useCallback(
    (messageId: string) => {
      const sent = deleteMessage(messageId);
      if (!sent) {
        setError('Нет соединения с сервером. Попробуйте позже.');
      }
    },
    [deleteMessage],
  );

  // Ресайз правой панели участников зажатием границы.
  // Панель закреплена у правого края, поэтому направление инвертировано
  const { width: membersWidth, handleMouseDown: onMembersResizeStart } = usePanelResize(
    280,
    220,
    420,
    { invert: true },
  );

  // Загрузка истории при выборе канала. Флаг отмены отбрасывает
  // устаревший ответ при быстром переключении между каналами
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
          // Сообщение, пришедшее по WebSocket во время загрузки истории,
          // не должно потеряться: история сливается с текущей лентой
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

  // Автоскролл к последнему сообщению после загрузки истории
  // и при появлении новых сообщений
  useEffect(() => {
    const container = messagesRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, channelId]);

  // Отправка текста через WebSocket; при отсутствии соединения
  // пользователю показывается ошибка, текст остаётся в поле
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

  // Канал не выбран: панель участников показывать некому
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

      {/* Разделитель: зажать мышью и тянуть для смены ширины панели */}
      <div
        className="resize-handle resize-handle--left"
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину панели участников"
        onMouseDown={onMembersResizeStart}
      />

      {/* key сбрасывает состояние панели при переключении канала */}
      <MembersPanel
        key={activeChannel.id}
        channelId={activeChannel.id}
        myRole={activeChannel.role}
        width={membersWidth}
      />
    </div>
  );
};
