import { useState, type FormEvent } from 'react';

const MAX_MESSAGE_LENGTH = 2000;

interface MessageComposerProps {
  onSend: (content: string) => boolean;
}

export const MessageComposer = ({ onSend }: MessageComposerProps) => {
  const [text, setText] = useState('');

  const canSend = text.trim().length > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const content = text.trim();
    if (!content) {
      return;
    }
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
