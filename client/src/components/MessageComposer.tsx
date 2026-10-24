import { useState, type FormEvent } from 'react';

// Максимальная длина сообщения — ограничение сервера (см. server messages.ts)
const MAX_MESSAGE_LENGTH = 2000;

interface MessageComposerProps {
  /** Отправка текста: false — сообщение не ушло (нет соединения) */
  onSend: (content: string) => boolean;
}

// Поле ввода сообщения: отправка по Enter или кнопке.
// Пустые и состоящие из пробелов сообщения блокируются до отправки
export const MessageComposer = ({ onSend }: MessageComposerProps) => {
  const [text, setText] = useState('');

  // Отправка доступна только с непустым текстом после обрезки
  const canSend = text.trim().length > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const content = text.trim();
    if (!content) {
      return;
    }
    // Поле очищается только после успешной отправки
    if (onSend(content)) {
      setText('');
    }
  };

  return (
    <form className="chat__composer" onSubmit={handleSubmit}>
      <input
        className="input"
        type="text"
        value={text}
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder="Введите сообщение..."
        aria-label="Текст сообщения"
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className="button" disabled={!canSend}>
        Отправить
      </button>
    </form>
  );
};
