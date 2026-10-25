const ACCESS_TOKEN_KEY = 'corp_messenger_access';
const REFRESH_TOKEN_KEY = 'corp_messenger_refresh';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export const getAccessToken = (): string | null => {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
};

export const getRefreshToken = (): string | null => {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
};

export const setTokenPair = (pair: TokenPair): void => {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, pair.accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, pair.refreshToken);
};

export const clearTokens = (): void => {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
};
