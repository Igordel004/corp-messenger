import { apiClient } from './client';

export interface ChannelMessage {
  id: string;
  channelId: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export const fetchChannelMessages = async (channelId: string): Promise<ChannelMessage[]> => {
  const response = await apiClient.get<ChannelMessage[]>(`/channels/${channelId}/messages`);
  return response.data;
};
