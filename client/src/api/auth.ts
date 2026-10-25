import { apiClient } from './client';
import { type TokenPair } from './token';

export interface RegisterPayload {
  fullName: string;
  email: string;
  password: string;
}

export interface RegisteredUser {
  id: string;
  fullName: string;
  email: string;
  globalRole: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'BLOCKED';
}

export interface LoginPayload {
  email: string;
  password: string;
}

export const registerEmployee = async (payload: RegisterPayload): Promise<RegisteredUser> => {
  const response = await apiClient.post<RegisteredUser>('/auth/register', payload);
  return response.data;
};

export const loginEmployee = async (payload: LoginPayload): Promise<TokenPair> => {
  const response = await apiClient.post<TokenPair>('/auth/login', payload);
  return response.data;
};

export const refreshSession = async (refreshToken: string): Promise<TokenPair> => {
  const response = await apiClient.post<TokenPair>('/auth/refresh', { refreshToken });
  return response.data;
};

export const logoutSession = async (refreshToken: string): Promise<void> => {
  await apiClient.post('/auth/logout', { refreshToken });
};

export const fetchCurrentUser = async (): Promise<RegisteredUser> => {
  const response = await apiClient.get<RegisteredUser>('/auth/me');
  return response.data;
};
