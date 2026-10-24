import { apiClient } from './client';

// Сообщение ленты канала: дата и время приходят строкой ISO
export interface ChannelMessage {
  id: string;
  channelId: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

// Лента сообщений канала: хронологический порядок от старых к новым
export const fetchChannelMessages = async (channelId: string): Promise<ChannelMessage[]> => {
  const response = await apiClient.get<ChannelMessage[]>(`/channels/${channelId}/messages`);
  return response.data;
};
