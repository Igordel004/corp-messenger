import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { loginEmployee, fetchCurrentUser, type RegisteredUser } from '../api/auth';
import { getAuthToken, setAuthToken, clearAuthToken } from '../api/token';

// Состояние аутентификации приложения
interface AuthContextValue {
  user: RegisteredUser | null;
  isAuthenticated: boolean;
  isRestoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Провайдер сессии: восстановление токена при загрузке и управление выходом
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  // Восстановление сессии из localStorage при первой загрузке приложения
  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setIsRestoring(false);
      return;
    }

    fetchCurrentUser()
      .then(setUser)
      .catch(() => clearAuthToken())
      .finally(() => setIsRestoring(false));
  }, []);

  // Аутентификация: получение токена и загрузка данных пользователя
  const login = useCallback(async (email: string, password: string) => {
    const { token } = await loginEmployee({ email, password });
    setAuthToken(token);
    const currentUser = await fetchCurrentUser();
    setUser(currentUser);
  }, []);

  // Выход: удаление токена и сброс состояния
  const logout = useCallback(() => {
    clearAuthToken();
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
