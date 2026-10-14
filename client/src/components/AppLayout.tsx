import { Outlet, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';

// Каркас приложения: шапка, боковая панель каналов и основная область
export const AppLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Выход: удаление сессии и перенаправление на страницу входа
  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="logo">
          <span className="logo__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6A1 1 0 0 1 4.3 19v-3.1A2.5 2.5 0 0 1 4 14.5v-9Z" />
            </svg>
          </span>
          <span className="logo__text">Мессенджер</span>
        </div>

        {user && (
          <div className="app-header__user">
            <div className="app-header__identity">
              <span className="app-header__name">{user.fullName}</span>
              <span className="app-header__email">{user.email}</span>
            </div>
            <span
              className={`badge ${user.status === 'ACTIVE' ? 'badge--online' : 'badge--danger'}`}
            >
              {user.status === 'ACTIVE' ? 'Активен' : 'Заблокирован'}
            </span>
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
              title="Создать канал (появится в Этапе 3)"
              aria-label="Создать канал"
            >
              +
            </button>
          </div>
          <div className="sidebar__search">
            <input
              className="input"
              type="search"
              placeholder="Поиск каналов"
              aria-label="Поиск каналов"
              disabled
            />
          </div>
          <div className="sidebar__list">
            <p className="sidebar__empty">
              Список каналов появится позже.
              <br />
              Сейчас это каркас прототипа.
            </p>
          </div>
        </aside>

        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
