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

export const setUserStatus = async (
  userId: string,
  status: AdminUserRecord['status'],
): Promise<AdminUserRecord> => {
  const response = await apiClient.patch<AdminUserRecord>(`/admin/users/${userId}/status`, {
    status,
  });
  return response.data;
};

export const setGlobalRole = async (
  userId: string,
  globalRole: AdminUserRecord['globalRole'],
): Promise<AdminUserRecord> => {
  const response = await apiClient.patch<AdminUserRecord>(`/admin/users/${userId}/role`, {
    globalRole,
  });
  return response.data;
};
