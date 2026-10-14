import { apiClient } from './client';

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

// Создание аккаунта сотрудника на сервере
export const registerEmployee = async (payload: RegisterPayload): Promise<RegisteredUser> => {
  const response = await apiClient.post<RegisteredUser>('/auth/register', payload);
  return response.data;
};
