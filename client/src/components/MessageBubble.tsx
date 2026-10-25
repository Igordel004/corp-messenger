import { formatMessageDate, formatMessageTime } from '../utils/dateTime';
import { type ChannelMessage } from '../api/messages';

interface MessageBubbleProps {
  message: ChannelMessage;
  isOutgoing: boolean;
  canDelete: boolean;
  onDelete: (messageId: string) => void;
}

export const MessageBubble = ({ message, isOutgoing, canDelete, onDelete }: MessageBubbleProps) => {
  return (
    <div className={`bubble ${isOutgoing ? 'bubble--outgoing' : 'bubble--incoming'}`}>
      {canDelete && (
        <button
          type="button"
          className="bubble__delete"
          title="Удалить сообщение"
          aria-label="Удалить сообщение"
          onClick={() => onDelete(message.id)}
        >
          ✕
        </button>
      )}
      <span className="bubble__author">{message.authorName}</span>
      <div>{message.content}</div>
      <div className="bubble__meta">
        <span>{formatMessageDate(message.createdAt)}</span>
        <span>{formatMessageTime(message.createdAt)}</span>
      </div>
    </div>
  );
};
