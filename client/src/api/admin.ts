import { apiClient } from './client';

export interface AdminUserRecord {
  id: string;
  fullName: string;
  email: string;
  globalRole: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'BLOCKED';
}

export const fetchAdminUsers = async (search?: string): Promise<AdminUserRecord[]> => {
  const params = search?.trim() ? { search: search.trim() } : undefined;
  const response = await apiClient.get<AdminUserRecord[]>('/admin/users', { params });
  return response.data;
};
