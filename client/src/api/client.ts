import axios, { type InternalAxiosRequestConfig } from 'axios';
import {
  getAccessToken,
  getRefreshToken,
  setTokenPair,
  clearTokens,
  type TokenPair,
} from './token';

// Базовый клиент REST API.
// В dev-режиме запросы /api проксируются Vite на сервер (см. vite.config.ts)
export const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Маршруты, на которых авто-обновление запрещено: ошибка входа
// не должна порождать запрос обновления сессии
const NO_REFRESH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

// Повтор запроса после обновления токена (защита от повторного цикла)
interface RetriableConfig extends InternalAxiosRequestConfig {
  retriedAfterRefresh?: boolean;
}

// Подстановка токена доступа в каждый исходящий запрос
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Единый запрос обновления на все параллельные 401: без этого
// несколько одновременных запросов запустили бы несколько ротаций
let refreshInFlight: Promise<TokenPair> | null = null;

const requestTokenRefresh = (): Promise<TokenPair> => {
  if (!refreshInFlight) {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      return Promise.reject(new Error('Refresh-токен отсутствует'));
    }
    // Прямой запрос через axios: apiClient добавил бы свой интерцептор 401
    refreshInFlight = axios
      .post<TokenPair>('/api/auth/refresh', { refreshToken })
      .then((response) => {
        setTokenPair(response.data);
        return response.data;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
};

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

// Ответ 401 при валидной сессии означает истёкший access-токен:
// сервер обновляет пару, запрос повторяется с новым токеном.
// При неудаче обновления сессия считается завершённой.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      error.config &&
      !NO_REFRESH_PATHS.some((path) => error.config?.url?.includes(path))
    ) {
      const config = error.config as RetriableConfig;
      if (!config.retriedAfterRefresh) {
        config.retriedAfterRefresh = true;
        try {
          const pair = await requestTokenRefresh();
          config.headers.Authorization = `Bearer ${pair.accessToken}`;
          return apiClient.request(config);
        } catch {
          clearTokens();
        }
      }
    }
    return Promise.reject(error);
  },
);
