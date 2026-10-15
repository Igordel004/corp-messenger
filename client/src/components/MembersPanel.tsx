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

// Модификатор бейджа по локальной роли участника
const ROLE_BADGES: Record<ChannelRole, string> = {
  OWNER: 'badge--owner',
  MODERATOR: 'badge--moderator',
  MEMBER: 'badge--member',
};

// Панель участников активного канала
interface MembersPanelProps {
  channelId: string;
  /** Локальная роль текущего пользователя в этом канале */
  myRole: ChannelRole;
}

export const MembersPanel = ({ channelId, myRole }: MembersPanelProps) => {
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);

  // Права по критериям задачи: добавляют владелец и модератор,
  // исключает и меняет роли только владелец
  const canAdd = myRole === 'OWNER' || myRole === 'MODERATOR';
  const canRemove = myRole === 'OWNER';
  const canChangeRole = myRole === 'OWNER';

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

  return (
    <aside className="members">
      <div className="members__header">
        <h2 className="members__title">Участники</h2>
        <span className="members__count">{members.length}</span>
      </div>

      {isLoading && <p className="sidebar__empty">Загрузка...</p>}
      {error && <p className="form-error members__error">{error}</p>}

      <div className="members__list">
        {members.map((member) => (
          <div key={member.userId} className="member-row">
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
            {canRemove && member.role !== 'OWNER' && (
              <button
                type="button"
                className="button button--ghost member-row__remove"
                title="Исключить из канала"
                aria-label={`Исключить ${member.fullName} из канала`}
                disabled={removingUserId === member.userId}
                onClick={() => handleRemove(member.userId)}
              >
                ✕
              </button>
            )}
            {/* Критерий 1: элементы смены роли видит только владелец;
                критерий 4: роль OWNER не переключается */}
            {canChangeRole && member.role !== 'OWNER' && (
              <button
                type="button"
                className="button button--ghost member-row__role"
                title={
                  member.role === 'MEMBER' ? 'Повысить до модератора' : 'Понизить до участника'
                }
                aria-label={
                  member.role === 'MEMBER'
                    ? `Повысить ${member.fullName} до модератора`
                    : `Понизить ${member.fullName} до участника`
                }
                disabled={changingRoleId === member.userId}
                onClick={() =>
                  handleChangeRole(member.userId, member.role === 'MEMBER' ? 'MODERATOR' : 'MEMBER')
                }
              >
                {member.role === 'MEMBER' ? '↑' : '↓'}
              </button>
            )}
          </div>
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
