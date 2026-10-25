import { apiClient } from './client';
import { type ChannelRole } from './channels';

export interface ChannelMember {
  userId: string;
  fullName: string;
  email: string;
  role: ChannelRole;
  joinedAt: string;
}

export interface AddedMember {
  userId: string;
  fullName: string;
  email: string;
  role: ChannelRole;
}

export const fetchChannelMembers = async (channelId: string): Promise<ChannelMember[]> => {
  const response = await apiClient.get<ChannelMember[]>(`/channels/${channelId}/members`);
  return response.data;
};

export const addChannelMemberByEmail = async (
  channelId: string,
  email: string,
): Promise<AddedMember> => {
  const response = await apiClient.post<AddedMember>(`/channels/${channelId}/members`, {
    email,
  });
  return response.data;
};

export const removeChannelMemberById = async (channelId: string, userId: string): Promise<void> => {
  await apiClient.delete(`/channels/${channelId}/members/${userId}`);
};

export const changeMemberRole = async (
  channelId: string,
  userId: string,
  role: ChannelRole,
): Promise<{ userId: string; role: ChannelRole }> => {
  const response = await apiClient.patch<{ userId: string; role: ChannelRole }>(
    `/channels/${channelId}/members/${userId}/role`,
    { role },
  );
  return response.data;
};
