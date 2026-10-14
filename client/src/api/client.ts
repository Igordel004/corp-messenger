import axios from 'axios';
import { getAuthToken, clearAuthToken } from './token';

// Базовый клиент REST API.
// В dev-режиме запросы /api проксируются Vite на сервер (см. vite.config.ts)
export const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Подстановка токена сессии в каждый исходящий запрос
apiClient.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Глобальная реакция на 401: токен истёк или отозван — сбрасываем сессию.
// Компоненты, защищённые маршрутом, увидят отсутствие токена и перенаправят на вход.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      clearAuthToken();
    }
    return Promise.reject(error);
  },
);

// Извлечение текста ошибки из ответа сервера или общий текст сбоя сети
export const getApiErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (data && typeof data === 'object' && 'message' in data) {
      const message = (data as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
  }
  return 'Не удалось связаться с сервером. Попробуйте позже.';
};
