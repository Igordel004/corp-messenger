// Заглушка окна чата: пузыри сообщений для демонстрации стиля.
// Реальный обмен сообщениями появится в Этапе 4 (WebSocket).

interface DemoMessage {
  id: string;
  author: string;
  text: string;
  time: string;
  outgoing: boolean;
}

const DEMO_MESSAGES: DemoMessage[] = [
  {
    id: '1',
    author: 'Анна Петрова',
    text: 'Добрый день! Готовы обсудить план спринта?',
    time: '12:40',
    outgoing: false,
  },
  {
    id: '2',
    author: 'Вы',
    text: 'Да, посмотрите, пожалуйста, задачу по регистрации.',
    time: '12:41',
    outgoing: true,
  },
  {
    id: '3',
    author: 'Анна Петрова',
    text: 'Принято. По дизайну правок не требуется.',
    time: '12:42',
    outgoing: false,
  },
];

// Окно чата-заглушка
export const ChatPage = () => (
  <section className="chat">
    <header className="chat__header">
      <span className="channel-item__avatar" aria-hidden="true">
        #
      </span>
      <div className="chat__header-body">
        <h1 className="chat__title">Общий</h1>
        <p className="chat__subtitle">Демонстрация ленты сообщений</p>
      </div>
    </header>

    <div className="chat__messages">
      {DEMO_MESSAGES.map((message) => (
        <div
          key={message.id}
          className={`bubble ${message.outgoing ? 'bubble--outgoing' : 'bubble--incoming'}`}
        >
          {!message.outgoing && <span className="bubble__author">{message.author}</span>}
          <div>{message.text}</div>
          <div className="bubble__meta">
            {message.outgoing && <span>Прочитано · </span>}
            <span>{message.time}</span>
          </div>
        </div>
      ))}
    </div>

    <div className="chat__composer">
      <input
        className="input"
        type="text"
        placeholder="Сообщения будут доступны в Этапе 4"
        aria-label="Текст сообщения"
        disabled
      />
      <button type="button" className="button" disabled>
        Отправить
      </button>
    </div>
  </section>
);
