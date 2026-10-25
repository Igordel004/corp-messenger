import { type UserChannel } from '../api/channels';

const TYPE_BADGES: Record<UserChannel['type'], { modifier: string; label: string }> = {
  PUBLIC: { modifier: 'badge--online', label: 'Публичный' },
  PRIVATE: { modifier: 'badge--moderator', label: 'Приватный' },
};

const ROLE_MODIFIERS: Record<UserChannel['role'], string> = {
  OWNER: 'badge--owner',
  MODERATOR: 'badge--moderator',
  MEMBER: 'badge--member',
};

const TypeBadge = ({ type }: { type: UserChannel['type'] }) => (
  <span className={`badge ${TYPE_BADGES[type].modifier}`}>{TYPE_BADGES[type].label}</span>
);

const RoleBadge = ({ role }: { role: UserChannel['role'] }) => (
  <span className={`badge ${ROLE_MODIFIERS[role]}`}>{role}</span>
);

interface ChannelListProps {
  channels: UserChannel[];
  isLoading: boolean;
  loadError: string | null;
  activeChannelId: string | null;
  onSelect: (channelId: string) => void;
}

export const ChannelList = ({
  channels,
  isLoading,
  loadError,
  activeChannelId,
  onSelect,
}: ChannelListProps) => {
  if (isLoading) {
    return <p className="sidebar__empty">Загрузка каналов...</p>;
  }

  if (loadError) {
    return <p className="sidebar__empty">{loadError}</p>;
  }

  if (channels.length === 0) {
    return (
      <p className="sidebar__empty">
        Каналов пока нет.
        <br />
        Нажмите «+», чтобы создать первый.
      </p>
    );
  }

  return (
    <>
      {channels.map((channel) => (
        <button
          key={channel.id}
          type="button"
          className={`channel-item ${channel.id === activeChannelId ? 'channel-item--active' : ''}`}
          onClick={() => onSelect(channel.id)}
        >
          <span className="channel-item__avatar" aria-hidden="true">
            {channel.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="channel-item__body">
            <span className="channel-item__row">
              <span className="channel-item__name">{channel.name}</span>
            </span>
            <span className="channel-item__badges">
              <TypeBadge type={channel.type} />
              <RoleBadge role={channel.role} />
            </span>
          </span>
        </button>
      ))}
    </>
  );
};
