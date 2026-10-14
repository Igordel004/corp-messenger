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

// Поля запроса аутентификации
export interface LoginPayload {
  email: string;
  password: string;
}

// Ответ сервера после успешного входа
export interface LoginResponse {
  token: string;
}

// Аутентификация: получение токена сессии по паре email и пароль
export const loginEmployee = async (payload: LoginPayload): Promise<LoginResponse> => {
  const response = await apiClient.post<LoginResponse>('/auth/login', payload);
  return response.data;
};

// Данные текущего аутентифицированного пользователя (защищённый маршрут)
export const fetchCurrentUser = async (): Promise<RegisteredUser> => {
  const response = await apiClient.get<RegisteredUser>('/auth/me');
  return response.data;
};
