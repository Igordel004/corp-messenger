import { apiClient } from './client';
import { type ChannelRole } from './channels';

// Участник канала для панели состава
export interface ChannelMember {
  userId: string;
  fullName: string;
  email: string;
  role: ChannelRole;
  joinedAt: string;
}

// Участник, подтверждённый сервером после добавления
export interface AddedMember {
  userId: string;
  fullName: string;
  email: string;
  role: ChannelRole;
}

// Список участников канала (доступен участникам канала)
export const fetchChannelMembers = async (channelId: string): Promise<ChannelMember[]> => {
  const response = await apiClient.get<ChannelMember[]>(`/channels/${channelId}/members`);
  return response.data;
};

// Добавление участника по email (право OWNER и MODERATOR)
export const addChannelMemberByEmail = async (
  channelId: string,
  email: string,
): Promise<AddedMember> => {
  const response = await apiClient.post<AddedMember>(`/channels/${channelId}/members`, {
    email,
  });
  return response.data;
};

// Исключение участника (право только OWNER)
export const removeChannelMemberById = async (channelId: string, userId: string): Promise<void> => {
  await apiClient.delete(`/channels/${channelId}/members/${userId}`);
};
