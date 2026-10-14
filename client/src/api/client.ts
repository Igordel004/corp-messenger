import axios from 'axios';

// Базовый клиент REST API.
// В dev-режиме запросы /api проксируются Vite на сервер (см. vite.config.ts)
export const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

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
