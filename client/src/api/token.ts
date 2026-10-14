// Хранение токена сессии в localStorage браузера.
// Ключ вынесен в константу, чтобы исключить расхождение имён в разных модулях.

const TOKEN_STORAGE_KEY = 'corp_messenger_token';

// Чтение токена сессии (null, если сессии нет)
export const getAuthToken = (): string | null => {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
};

// Сохранение токена после успешной аутентификации
export const setAuthToken = (token: string): void => {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
};

// Удаление токена при выходе из системы
export const clearAuthToken = (): void => {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
};
