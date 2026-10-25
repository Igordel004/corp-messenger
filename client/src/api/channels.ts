import { apiClient } from './client';

export type ChannelType = 'PUBLIC' | 'PRIVATE';

export type ChannelRole = 'OWNER' | 'MODERATOR' | 'MEMBER';

export interface CreateChannelPayload {
  name: string;
  type: ChannelType;
}

export interface CreatedChannel {
  id: string;
  name: string;
  type: ChannelType;
  role: ChannelRole;
}

export interface UserChannel {
  id: string;
  name: string;
  type: ChannelType;
  role: ChannelRole;
  joinedAt: string;
}

export interface CatalogChannel {
  id: string;
  name: string;
  type: ChannelType;
  isMember: boolean;
}

export interface JoinedChannel {
  id: string;
  name: string;
  type: ChannelType;
  role: ChannelRole;
}

export const createChannel = async (payload: CreateChannelPayload): Promise<CreatedChannel> => {
  const response = await apiClient.post<CreatedChannel>('/channels', payload);
  return response.data;
};

export const fetchUserChannels = async (): Promise<UserChannel[]> => {
  const response = await apiClient.get<UserChannel[]>('/channels');
  return response.data;
};

export const fetchChannelCatalog = async (): Promise<CatalogChannel[]> => {
  const response = await apiClient.get<CatalogChannel[]>('/channels/catalog');
  return response.data;
};

export const joinChannelById = async (channelId: string): Promise<JoinedChannel> => {
  const response = await apiClient.post<JoinedChannel>(`/channels/${channelId}/join`);
  return response.data;
};
