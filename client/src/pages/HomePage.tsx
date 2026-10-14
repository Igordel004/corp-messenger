import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';

// Главный экран после входа: данные сотрудника и управление сессией
export const HomePage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Выход: удаление токена и перенаправление на страницу входа
  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  if (!user) {
    return null;
  }

  return (
    <main style={{ maxWidth: 520, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h1>Корпоративный мессенджер</h1>
      <section style={{ border: '1px solid #ccc', borderRadius: 6, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Профиль сотрудника</h2>
        <p>
          <strong>Имя:</strong> {user.fullName}
        </p>
        <p>
          <strong>Email:</strong> {user.email}
        </p>
        <p>
          <strong>Роль:</strong> {user.globalRole}
        </p>
        <p>
          <strong>Статус:</strong> {user.status}
        </p>
      </section>
      <button type="button" onClick={handleLogout} style={{ marginTop: 16 }}>
        Выйти
      </button>
    </main>
  );
};
