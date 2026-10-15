import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { loginEmployee, logoutSession, fetchCurrentUser, type RegisteredUser } from '../api/auth';
import { getAccessToken, getRefreshToken, setTokenPair, clearTokens } from '../api/token';

// Состояние аутентификации приложения
interface AuthContextValue {
  user: RegisteredUser | null;
  isAuthenticated: boolean;
  isRestoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Провайдер сессии: восстановление пары токенов и управление выходом
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  // Восстановление сессии при первой загрузке приложения.
  // Если access истёк, интерцептор сам обновит пару и повторит запрос.
  useEffect(() => {
    if (!getAccessToken()) {
      setIsRestoring(false);
      return;
    }

    fetchCurrentUser()
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setIsRestoring(false));
  }, []);

  // Аутентификация: сохранение пары токенов и загрузка пользователя
  const login = useCallback(async (email: string, password: string) => {
    const pair = await loginEmployee({ email, password });
    setTokenPair(pair);
    const currentUser = await fetchCurrentUser();
    setUser(currentUser);
  }, []);

  // Выход: сервер отзывает refresh-токен, локальная пара удаляется
  const logout = useCallback(() => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      // Отзыв выполняется в фоне: выход не должен зависеть от сети
      logoutSession(refreshToken).catch(() => undefined);
    }
    clearTokens();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isRestoring,
      login,
      logout,
    }),
    [user, isRestoring, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Хук доступа к состоянию аутентификации
export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth должен использоваться внутри AuthProvider');
  }
  return context;
};
