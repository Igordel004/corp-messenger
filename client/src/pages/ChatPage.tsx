// Лента сообщений активного канала: история загружается по REST
// в хронологическом порядке (от старых к новым), каждое сообщение
// показывает имя автора, дату, время и текст.
// Отправка сообщений и живые обновления появятся в следующей фиче.

import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import { type LayoutOutletContext } from '../components/AppLayout';
import { MembersPanel } from '../components/MembersPanel';
import { usePanelResize } from '../hooks/usePanelResize';
import { fetchChannelMessages, type ChannelMessage } from '../api/messages';
import { getApiErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { formatMessageDate, formatMessageTime } from '../utils/dateTime';

// Подпись типа приватности в шапке чата
const TYPE_LABELS: Record<'PUBLIC' | 'PRIVATE', string> = {
  PUBLIC: 'Публичный канал',
  PRIVATE: 'Приватный канал',
};

// Хронологическая упорядоченность ленты: ISO-строки дат сравнимы
// лексикографически, поэтому сортировка детерминирована
const sortChronologically = (list: ChannelMessage[]): ChannelMessage[] =>
  [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

// Окно чата: лента истории активного канала и панель участников
export const ChatPage = () => {
  const { activeChannel } = useOutletContext<LayoutOutletContext>();
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Контейнер ленты: прокрутка к последнему сообщению
  const messagesRef = useRef<HTMLDivElement | null>(null);

  // Ресайз правой панели участников зажатием границы.
  // Панель закреплена у правого края, поэтому направление инвертировано
  const { width: membersWidth, handleMouseDown: onMembersResizeStart } = usePanelResize(
    280,
    220,
    420,
    { invert: true },
  );

  const channelId = activeChannel?.id ?? null;

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
          setMessages(sortChronologically(history));
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
            <div
              key={message.id}
              className={`bubble ${message.authorId === user?.id ? 'bubble--outgoing' : 'bubble--incoming'}`}
            >
              <span className="bubble__author">{message.authorName}</span>
              <div>{message.content}</div>
              <div className="bubble__meta">
                <span>{formatMessageDate(message.createdAt)}</span>
                <span>{formatMessageTime(message.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="chat__composer">
          <input
            className="input"
            type="text"
            placeholder="Отправка сообщений появится позже"
            aria-label="Текст сообщения"
            disabled
          />
          <button type="button" className="button" disabled>
            Отправить
          </button>
        </div>
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
