import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  fetchChannelMembers,
  addChannelMemberByEmail,
  removeChannelMemberById,
  changeMemberRole,
  type ChannelMember,
} from '../api/members';
import { type ChannelRole } from '../api/channels';
import { getApiErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Модификатор бейджа по локальной роли участника
const ROLE_BADGES: Record<ChannelRole, string> = {
  OWNER: 'badge--owner',
  MODERATOR: 'badge--moderator',
  MEMBER: 'badge--member',
};

// Строка участника в панели: аватар, имя, роль и кнопки действий.
// Кнопки исключения и смены роли видит только владелец;
// кнопка выхода — на собственной строке любого не-владельца.
interface MemberRowProps {
  member: ChannelMember;
  myRole: ChannelRole;
  currentUserId: string | undefined;
  removingUserId: string | null;
  changingRoleId: string | null;
  isLeaving: boolean;
  onRemove: (userId: string) => void;
  onChangeRole: (userId: string, role: ChannelRole) => void;
  onLeave: () => void;
}

const MemberRow = ({
  member,
  myRole,
  currentUserId,
  removingUserId,
  changingRoleId,
  isLeaving,
  onRemove,
  onChangeRole,
  onLeave,
}: MemberRowProps) => {
  const isOwner = myRole === 'OWNER';
  const isSelf = currentUserId === member.userId;

  return (
    <div className="member-row">
      <span className="member-row__avatar" aria-hidden="true">
        {member.fullName.trim().charAt(0).toUpperCase()}
      </span>
      <div className="member-row__body">
        <div className="member-row__row">
          <span className="member-row__name">{member.fullName}</span>
          <span className={`badge ${ROLE_BADGES[member.role]}`}>{member.role}</span>
        </div>
        <span className="member-row__email">{member.email}</span>
      </div>

      {isOwner && member.role !== 'OWNER' && (
        <button
          type="button"
          className="button button--ghost member-row__remove"
          title="Исключить из канала"
          aria-label={`Исключить ${member.fullName} из канала`}
          disabled={removingUserId === member.userId}
          onClick={() => onRemove(member.userId)}
        >
          ✕
        </button>
      )}

      {/* Элементы смены роли видит только владелец; роль OWNER не переключается */}
      {isOwner && member.role !== 'OWNER' && (
        <button
          type="button"
          className="button button--ghost member-row__role"
          title={member.role === 'MEMBER' ? 'Повысить до модератора' : 'Понизить до участника'}
          aria-label={
            member.role === 'MEMBER'
              ? `Повысить ${member.fullName} до модератора`
              : `Понизить ${member.fullName} до участника`
          }
          disabled={changingRoleId === member.userId}
          onClick={() =>
            onChangeRole(member.userId, member.role === 'MEMBER' ? 'MODERATOR' : 'MEMBER')
          }
        >
          {member.role === 'MEMBER' ? '↑' : '↓'}
        </button>
      )}

      {/* Выход из канала: только на собственной строке и не у владельца */}
      {isSelf && !isOwner && (
        <button
          type="button"
          className="button button--ghost member-row__leave"
          title="Выйти из канала"
          aria-label="Выйти из канала"
          disabled={isLeaving}
          onClick={onLeave}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
          </svg>
        </button>
      )}
    </div>
  );
};

// Панель участников активного канала
interface MembersPanelProps {
  channelId: string;
  /** Локальная роль текущего пользователя в этом канале */
  myRole: ChannelRole;
  /** Текущая ширина панели (задаётся ресайзом в родителе) */
  width: number;
}

export const MembersPanel = ({ channelId, myRole, width }: MembersPanelProps) => {
  const { user } = useAuth();
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);

  // Права по критериям задачи: добавляют владелец и модератор.
  // Исключение, смена роли и выход из канала проверяются в MemberRow.
  const canAdd = myRole === 'OWNER' || myRole === 'MODERATOR';

  const loadMembers = useCallback(async () => {
    try {
      setMembers(await fetchChannelMembers(channelId));
      setError(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [channelId]);

  // Загрузка состава при открытии канала
  useEffect(() => {
    setIsLoading(true);
    loadMembers();
  }, [loadMembers]);

  // Добавление участника по email с перезагрузкой списка
  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (!inviteEmail.trim()) {
      return;
    }

    setIsAdding(true);
    try {
      await addChannelMemberByEmail(channelId, inviteEmail.trim());
      setInviteEmail('');
      await loadMembers();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setIsAdding(false);
    }
  };

  // Исключение участника с перезагрузкой списка
  const handleRemove = async (userId: string) => {
    setRemovingUserId(userId);
    try {
      await removeChannelMemberById(channelId, userId);
      await loadMembers();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setRemovingUserId(null);
    }
  };

  // Переключение роли между MEMBER и MODERATOR (критерии 2 и 3)
  const handleChangeRole = async (userId: string, role: ChannelRole) => {
    setChangingRoleId(userId);
    try {
      await changeMemberRole(channelId, userId, role);
      await loadMembers();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setChangingRoleId(null);
    }
  };

  // Выход участника из канала: удаляет собственную запись и
  // уведомляет панель каналов, чтобы её список обновился
  const handleLeave = async () => {
    if (!user) {
      return;
    }
    setIsLeaving(true);
    try {
      await removeChannelMemberById(channelId, user.id);
      window.dispatchEvent(new CustomEvent('channels-refresh'));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setIsLeaving(false);
    }
  };

  return (
    <aside className="members" style={{ width }}>
      <div className="members__header">
        <h2 className="members__title">Участники</h2>
        <span className="members__count">{members.length}</span>
      </div>

      {isLoading && <p className="sidebar__empty">Загрузка...</p>}
      {error && <p className="form-error members__error">{error}</p>}

      <div className="members__list">
        {members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            myRole={myRole}
            currentUserId={user?.id}
            removingUserId={removingUserId}
            changingRoleId={changingRoleId}
            isLeaving={isLeaving}
            onRemove={handleRemove}
            onChangeRole={handleChangeRole}
            onLeave={handleLeave}
          />
        ))}
      </div>

      {canAdd && (
        <form className="members__add" onSubmit={handleAdd} noValidate>
          <input
            className="input"
            type="email"
            value={inviteEmail}
            placeholder="Email сотрудника"
            aria-label="Email приглашаемого сотрудника"
            onChange={(event) => setInviteEmail(event.target.value)}
          />
          <button type="submit" className="button button--secondary" disabled={isAdding}>
            {isAdding ? 'Добавление...' : 'Добавить участника'}
          </button>
        </form>
      )}
    </aside>
  );
};
