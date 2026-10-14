import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

// Защищённый маршрут: без аутентификации перенаправляет на страницу входа
export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isAuthenticated, isRestoring } = useAuth();
  const navigate = useNavigate();

  // Пока восстанавливаем сессию из localStorage, ничего не решаем
  useEffect(() => {
    if (!isRestoring && !isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isRestoring, isAuthenticated, navigate]);

  // Без аутентификации защищённое содержимое не рендерится
  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
};
