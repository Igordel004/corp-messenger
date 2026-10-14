import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { fetchUserChannels, type UserChannel } from '../api/channels';
import { getApiErrorMessage } from '../api/client';
import { CreateChannelModal } from './CreateChannelModal';
import { ChannelList } from './ChannelList';

// Каркас приложения: шапка, боковая панель каналов и основная область
export const AppLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isProfileOpen = pathname === '/profile';

  const [channels, setChannels] = useState<UserChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);

  // Загрузка каналов пользователя при монтировании каркаса
  useEffect(() => {
    let isCancelled = false;

    fetchUserChannels()
      .then((data) => {
        if (isCancelled) {
          return;
        }
        setChannels(data);
        setActiveChannelId((current) => current ?? data[0]?.id ?? null);
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

  // Выход: удаление сессии и перенаправление на страницу входа
  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  // Новый канал становится выбранным и попадает в начало списка
  const handleChannelCreated = (channel: {
    id: string;
    name: string;
    type: UserChannel['type'];
    role: UserChannel['role'];
  }) => {
    setIsModalOpen(false);
    setChannels((current) => [{ ...channel, joinedAt: new Date().toISOString() }, ...current]);
    setActiveChannelId(channel.id);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="logo" aria-label="Перейти к чату">
          <span className="logo__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6A1 1 0 0 1 4.3 19v-3.1A2.5 2.5 0 0 1 4 14.5v-9Z" />
            </svg>
          </span>
          <span className="logo__text">Мессенджер</span>
        </Link>

        {user && (
          <div className="app-header__user">
            <Link
              to="/profile"
              className={`app-header__identity${isProfileOpen ? ' app-header__identity--active' : ''}`}
              aria-label="Перейти к профилю"
            >
              <span className="app-header__name">{user.fullName}</span>
              <span className="app-header__email">{user.email}</span>
            </Link>
            <button type="button" className="button button--secondary" onClick={handleLogout}>
              Выйти
            </button>
          </div>
        )}
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar__header">
            <h2 className="sidebar__title">Каналы</h2>
            <button
              type="button"
              className="button button--ghost"
              title="Создать канал"
              aria-label="Создать канал"
              onClick={() => setIsModalOpen(true)}
            >
              +
            </button>
          </div>

          <div className="sidebar__list">
            <ChannelList
              channels={channels}
              isLoading={isLoading}
              loadError={loadError}
              activeChannelId={activeChannelId}
              onSelect={setActiveChannelId}
            />
          </div>
        </aside>

        <main className="app-main">
          <Outlet />
        </main>
      </div>

      {isModalOpen && (
        <CreateChannelModal
          onCancel={() => setIsModalOpen(false)}
          onCreated={handleChannelCreated}
        />
      )}
    </div>
  );
};
