import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isAuthenticated, isRestoring } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isRestoring && !isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isRestoring, isAuthenticated, navigate]);

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
};
