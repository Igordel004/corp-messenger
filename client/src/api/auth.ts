import { apiClient } from './client';
import { type TokenPair } from './token';

// Поля запроса регистрации сотрудника
export interface RegisterPayload {
  fullName: string;
  email: string;
  password: string;
}

// Ответ сервера после создания аккаунта (без данных пароля)
export interface RegisteredUser {
  id: string;
  fullName: string;
  email: string;
  globalRole: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'BLOCKED';
}

// Поля запроса аутентификации
export interface LoginPayload {
  email: string;
  password: string;
}

// Создание аккаунта сотрудника на сервере
export const registerEmployee = async (payload: RegisterPayload): Promise<RegisteredUser> => {
  const response = await apiClient.post<RegisteredUser>('/auth/register', payload);
  return response.data;
};

// Аутентификация: сервер выдаёт пару access и refresh токенов
export const loginEmployee = async (payload: LoginPayload): Promise<TokenPair> => {
  const response = await apiClient.post<TokenPair>('/auth/login', payload);
  return response.data;
};

// Обновление сессии: ротация пары токенов на сервере
export const refreshSession = async (refreshToken: string): Promise<TokenPair> => {
  const response = await apiClient.post<TokenPair>('/auth/refresh', { refreshToken });
  return response.data;
};

// Выход из системы: сервер отзывает refresh-токен
export const logoutSession = async (refreshToken: string): Promise<void> => {
  await apiClient.post('/auth/logout', { refreshToken });
};

// Данные текущего аутентифицированного пользователя (защищённый маршрут)
export const fetchCurrentUser = async (): Promise<RegisteredUser> => {
  const response = await apiClient.get<RegisteredUser>('/auth/me');
  return response.data;
};
