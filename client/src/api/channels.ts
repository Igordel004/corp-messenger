import { apiClient } from './client';

// Тип приватности канала (соответствует enum схемы БД)
export type ChannelType = 'PUBLIC' | 'PRIVATE';

// Локальная роль участника в канале
export type ChannelRole = 'OWNER' | 'MODERATOR' | 'MEMBER';

// Поля запроса создания канала
export interface CreateChannelPayload {
  name: string;
  type: ChannelType;
}

// Ответ сервера после создания канала
export interface CreatedChannel {
  id: string;
  name: string;
  type: ChannelType;
  role: ChannelRole;
}

// Канал пользователя для боковой панели
export interface UserChannel {
  id: string;
  name: string;
  type: ChannelType;
  role: ChannelRole;
  joinedAt: string;
}

// Строка каталога каналов с признаком участия
export interface CatalogChannel {
  id: string;
  name: string;
  type: ChannelType;
  isMember: boolean;
}

// Канал, подтверждённый сервером после вступления
export interface JoinedChannel {
  id: string;
  name: string;
  type: ChannelType;
  role: ChannelRole;
}

// Создание канала: автором назначается текущий аутентифицированный пользователь
export const createChannel = async (payload: CreateChannelPayload): Promise<CreatedChannel> => {
  const response = await apiClient.post<CreatedChannel>('/channels', payload);
  return response.data;
};

// Каналы текущего пользователя (для боковой панели)
export const fetchUserChannels = async (): Promise<UserChannel[]> => {
  const response = await apiClient.get<UserChannel[]>('/channels');
  return response.data;
};

// Каталог: публичные каналы и приватные с участием пользователя
export const fetchChannelCatalog = async (): Promise<CatalogChannel[]> => {
  const response = await apiClient.get<CatalogChannel[]>('/channels/catalog');
  return response.data;
};

// Вступление в открытый канал с ролью MEMBER
export const joinChannelById = async (channelId: string): Promise<JoinedChannel> => {
  const response = await apiClient.post<JoinedChannel>(`/channels/${channelId}/join`);
  return response.data;
};
