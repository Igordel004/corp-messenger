import { useEffect, useMemo, useState } from 'react';
import { fetchChannelCatalog, joinChannelById, type CatalogChannel } from '../api/channels';
import { getApiErrorMessage } from '../api/client';

// Бейдж типа приватности канала
const TYPE_BADGES: Record<CatalogChannel['type'], { modifier: string; label: string }> = {
  PUBLIC: { modifier: 'badge--online', label: 'Публичный' },
  PRIVATE: { modifier: 'badge--moderator', label: 'Приватный' },
};

// Карточка канала в каталоге
interface CatalogCardProps {
  channel: CatalogChannel;
  onJoin: (channelId: string) => void;
  isJoining: boolean;
}

const CatalogCard = ({ channel, onJoin, isJoining }: CatalogCardProps) => (
  <div className="catalog-card">
    <span className="channel-item__avatar" aria-hidden="true">
      #
    </span>
    <div className="catalog-card__body">
      <div className="catalog-card__row">
        <span className="catalog-card__name">{channel.name}</span>
        <span className={`badge ${TYPE_BADGES[channel.type].modifier}`}>
          {TYPE_BADGES[channel.type].label}
        </span>
      </div>
      {channel.isMember ? (
        <span className="badge badge--member">Вы участник</span>
      ) : channel.type === 'PUBLIC' ? (
        <button
          type="button"
          className="button button--secondary catalog-card__join"
          onClick={() => onJoin(channel.id)}
          disabled={isJoining}
        >
          {isJoining ? 'Вступление...' : 'Вступить'}
        </button>
      ) : (
        <span className="catalog-card__hint">Приватный канал — вступление по приглашению</span>
      )}
    </div>
  </div>
);

// Страница каталога каналов с поиском по названию
export const CatalogPage = () => {
  const [channels, setChannels] = useState<CatalogChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    fetchChannelCatalog()
      .then((data) => {
        if (!isCancelled) {
          setChannels(data);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setLoadError(getApiErrorMessage(error));
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  // Поиск фильтрует каталог по названию без запроса к серверу
  const visibleChannels = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return channels;
    }
    return channels.filter((channel) => channel.name.toLowerCase().includes(query));
  }, [channels, search]);

  // Вступление: сервер подтверждает роль, канал помечается участником
  const handleJoin = async (channelId: string) => {
    setJoiningId(channelId);
    try {
      await joinChannelById(channelId);
      setChannels((current) =>
        current.map((channel) =>
          channel.id === channelId ? { ...channel, isMember: true } : channel,
        ),
      );
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="catalog">
      <div className="catalog__header">
        <h1 className="catalog__title">Каталог каналов</h1>
        <input
          className="input catalog__search"
          type="search"
          value={search}
          placeholder="Поиск по названию"
          aria-label="Поиск каналов по названию"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {isLoading && <p className="sidebar__empty">Загрузка каталога...</p>}

      {!isLoading && loadError && <p className="form-error">{loadError}</p>}

      {!isLoading && !loadError && visibleChannels.length === 0 && (
        <p className="sidebar__empty">
          {search ? 'Каналы по вашему запросу не найдены.' : 'Открытых каналов пока нет.'}
        </p>
      )}

      <div className="catalog__list">
        {visibleChannels.map((channel) => (
          <CatalogCard
            key={channel.id}
            channel={channel}
            onJoin={handleJoin}
            isJoining={joiningId === channel.id}
          />
        ))}
      </div>
    </div>
  );
};
