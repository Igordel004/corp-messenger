import { useCallback, useEffect, useState } from 'react';
import { fetchAdminUsers, type AdminUserRecord } from '../api/admin';
import { getApiErrorMessage } from '../api/client';

const ROLE_BADGES: Record<AdminUserRecord['globalRole'], { modifier: string; label: string }> = {
  ADMIN: { modifier: 'badge--owner', label: 'Администратор' },
  USER: { modifier: 'badge--member', label: 'Пользователь' },
};

const STATUS_BADGES: Record<AdminUserRecord['status'], { modifier: string; label: string }> = {
  ACTIVE: { modifier: 'badge--online', label: 'Активен' },
  BLOCKED: { modifier: 'badge--danger', label: 'Заблокирован' },
};

export const AdminPage = () => {
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadUsers = useCallback(async (query: string) => {
    setIsLoading(true);
    try {
      setUsers(await fetchAdminUsers(query));
      setError(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers(search);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, loadUsers]);

  return (
    <div className="admin">
      <header className="admin__header">
        <div>
          <h1 className="admin__title">Реестр сотрудников</h1>
          <p className="admin__subtitle">Всего: {users.length}</p>
        </div>
        <input
          className="input admin__search"
          type="search"
          value={search}
          placeholder="Поиск по имени или email"
          aria-label="Поиск сотрудника"
          onChange={(event) => setSearch(event.target.value)}
        />
      </header>

      {error && <p className="form-error">{error}</p>}

      <div className="admin__table-wrap">
        <table className="admin__table">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Email</th>
              <th>Глобальная роль</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="admin__hint">
                  Загрузка...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={4} className="admin__hint">
                  Сотрудники не найдены
                </td>
              </tr>
            ) : (
              users.map((record) => (
                <tr key={record.id}>
                  <td>{record.fullName}</td>
                  <td>{record.email}</td>
                  <td>
                    <span className={`badge ${ROLE_BADGES[record.globalRole].modifier}`}>
                      {ROLE_BADGES[record.globalRole].label}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGES[record.status].modifier}`}>
                      {STATUS_BADGES[record.status].label}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
