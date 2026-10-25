import { useCallback, useEffect, useState } from 'react';
import { fetchAdminUsers, setUserStatus, setGlobalRole, type AdminUserRecord } from '../api/admin';
import { getApiErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';

const ROLE_BADGES: Record<AdminUserRecord['globalRole'], { modifier: string; label: string }> = {
  ADMIN: { modifier: 'badge--owner', label: 'Администратор' },
  USER: { modifier: 'badge--member', label: 'Пользователь' },
};

const STATUS_BADGES: Record<AdminUserRecord['status'], { modifier: string; label: string }> = {
  ACTIVE: { modifier: 'badge--online', label: 'Активен' },
  BLOCKED: { modifier: 'badge--danger', label: 'Заблокирован' },
};

interface UserRowProps {
  record: AdminUserRecord;
  isSelf: boolean;
  busyId: string | null;
  onSetStatus: (userId: string, status: AdminUserRecord['status']) => void;
  onSetRole: (userId: string, role: AdminUserRecord['globalRole']) => void;
}

const UserRow = ({ record, isSelf, busyId, onSetStatus, onSetRole }: UserRowProps) => {
  const isBusy = busyId === record.id;

  return (
    <tr>
      <td>
        {record.fullName}
        {isSelf && ' (вы)'}
      </td>
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
      <td>
        {!isSelf && (
          <div className="admin__actions">
            {record.status === 'ACTIVE' ? (
              <button
                type="button"
                className="button button--secondary button--small"
                disabled={isBusy}
                onClick={() => onSetStatus(record.id, 'BLOCKED')}
              >
                Заблокировать
              </button>
            ) : (
              <button
                type="button"
                className="button button--secondary button--small"
                disabled={isBusy}
                onClick={() => onSetStatus(record.id, 'ACTIVE')}
              >
                Разблокировать
              </button>
            )}
            {record.globalRole === 'USER' ? (
              <button
                type="button"
                className="button button--secondary button--small"
                disabled={isBusy}
                onClick={() => onSetRole(record.id, 'ADMIN')}
              >
                Назначить админом
              </button>
            ) : (
              <button
                type="button"
                className="button button--secondary button--small"
                disabled={isBusy}
                onClick={() => onSetRole(record.id, 'USER')}
              >
                Снять админа
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
};

export const AdminPage = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const applyUpdate = useCallback(async (action: () => Promise<AdminUserRecord>) => {
    try {
      const updated = await action();
      setUsers((current) => current.map((record) => (record.id === updated.id ? updated : record)));
      setError(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleSetStatus = useCallback(
    (userId: string, status: AdminUserRecord['status']) => {
      setBusyId(userId);
      void applyUpdate(() => setUserStatus(userId, status));
    },
    [applyUpdate],
  );

  const handleSetRole = useCallback(
    (userId: string, globalRole: AdminUserRecord['globalRole']) => {
      setBusyId(userId);
      void applyUpdate(() => setGlobalRole(userId, globalRole));
    },
    [applyUpdate],
  );

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
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="admin__hint">
                  Загрузка...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="admin__hint">
                  Сотрудники не найдены
                </td>
              </tr>
            ) : (
              users.map((record) => (
                <UserRow
                  key={record.id}
                  record={record}
                  isSelf={record.id === user?.id}
                  busyId={busyId}
                  onSetStatus={handleSetStatus}
                  onSetRole={handleSetRole}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
