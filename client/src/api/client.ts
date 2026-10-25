import axios, { type InternalAxiosRequestConfig } from 'axios';
import {
  getAccessToken,
  getRefreshToken,
  setTokenPair,
  clearTokens,
  type TokenPair,
} from './token';

export const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

const NO_REFRESH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

interface RetriableConfig extends InternalAxiosRequestConfig {
  retriedAfterRefresh?: boolean;
}

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Единый запрос обновления на все параллельные 401: без этого
// несколько одновременных запросов запустили бы несколько ротаций.
// Той же функцией пользуется переподключение WebSocket после 4401
let refreshInFlight: Promise<TokenPair> | null = null;

export const refreshTokens = (): Promise<TokenPair> => {
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
          const pair = await refreshTokens();
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
