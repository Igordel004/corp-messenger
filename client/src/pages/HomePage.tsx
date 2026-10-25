import { useAuth } from '../context/AuthContext';

const getInitials = (fullName: string): string =>
  fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

const ROLE_LABELS: Record<string, string> = {
  USER: 'Пользователь',
  ADMIN: 'Администратор',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Активен',
  BLOCKED: 'Заблокирован',
};

export const HomePage = () => {
  const { user } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <div className="profile">
      <div className="profile__card">
        <div className="profile__header">
          <div className="profile__avatar" aria-hidden="true">
            {getInitials(user.fullName)}
          </div>
          <div>
            <h1 className="profile__name">{user.fullName}</h1>
            <p className="profile__email">{user.email}</p>
          </div>
        </div>

        <div className="profile__grid">
          <div className="profile__tile">
            <p className="profile__tile-label">Глобальная роль</p>
            <p className="profile__tile-value">{ROLE_LABELS[user.globalRole] ?? user.globalRole}</p>
          </div>
          <div className="profile__tile">
            <p className="profile__tile-label">Статус аккаунта</p>
            <p className="profile__tile-value">{STATUS_LABELS[user.status] ?? user.status}</p>
          </div>
        </div>

        <div className="profile__row">
          <span className="profile__row-label">Идентификатор</span>
          <span className="badge badge--member">{user.id.slice(0, 8)}</span>
        </div>
        <div className="profile__row">
          <span className="profile__row-label">Роль в системе</span>
          <span
            className={`badge ${user.globalRole === 'ADMIN' ? 'badge--owner' : 'badge--member'}`}
          >
            {user.globalRole}
          </span>
        </div>
        <div className="profile__row">
          <span className="profile__row-label">Состояние</span>
          <span className={`badge ${user.status === 'ACTIVE' ? 'badge--online' : 'badge--danger'}`}>
            {STATUS_LABELS[user.status] ?? user.status}
          </span>
        </div>
      </div>
    </div>
  );
};
