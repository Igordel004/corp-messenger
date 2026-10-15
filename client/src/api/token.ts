// Хранение пары токенов сессии в localStorage браузера.
// Access-токен подставляется в запросы, refresh — только в эндпоинт
// обновления сессии; ключи вынесены в константы во избежание расхождений.

const ACCESS_TOKEN_KEY = 'corp_messenger_access';
const REFRESH_TOKEN_KEY = 'corp_messenger_refresh';

// Пара токенов, получаемая от сервера
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Чтение токена доступа (null, если сессии нет)
export const getAccessToken = (): string | null => {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
};

// Чтение токена обновления
export const getRefreshToken = (): string | null => {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
};

// Сохранение пары после входа или обновления сессии
export const setTokenPair = (pair: TokenPair): void => {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, pair.accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, pair.refreshToken);
};

// Удаление пары при выходе из системы
export const clearTokens = (): void => {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
};
