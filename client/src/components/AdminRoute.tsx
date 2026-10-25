import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';

interface AdminRouteProps {
  children: React.ReactNode;
}

export const AdminRoute = ({ children }: AdminRouteProps) => {
  const { user, isRestoring } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.globalRole === 'ADMIN';

  useEffect(() => {
    if (!isRestoring && !isAdmin) {
      navigate('/', { replace: true });
    }
  }, [isRestoring, isAdmin, navigate]);

  if (!isAdmin) {
    return null;
  }

  return <>{children}</>;
};
