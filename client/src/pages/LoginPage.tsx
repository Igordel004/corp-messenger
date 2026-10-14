import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { getApiErrorMessage } from '../api/client';

const CORPORATE_DOMAIN = '@corp.messenger.com';

// Локальные ошибки формы (проверяются до отправки на сервер)
interface FieldErrors {
  email?: string;
  password?: string;
}

// Клиентская валидация полей формы входа
const validateLoginForm = (email: string, password: string): FieldErrors => {
  const errors: FieldErrors = {};
  if (!email.includes(CORPORATE_DOMAIN)) {
    errors.email = `Разрешена только корпоративная почта (домен ${CORPORATE_DOMAIN})`;
  }
  if (password.length === 0) {
    errors.password = 'Введите пароль';
  }
  return errors;
};

// Страница аутентификации сотрудника
export const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateLoginForm(email, password);
    setFieldErrors(errors);
    setServerError(null);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (error) {
      // Отображение ошибок сервера: неверные данные (401), блокировка (403)
      setServerError(getApiErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main style={{ maxWidth: 420, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h1>Вход в систему</h1>
      <form onSubmit={handleSubmit} noValidate>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="email">Корпоративный email</label>
          <br />
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ width: '100%', padding: 6 }}
          />
          {fieldErrors.email && (
            <p style={{ color: 'red', margin: '4px 0 0' }}>{fieldErrors.email}</p>
          )}
        </div>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="password">Пароль</label>
          <br />
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ width: '100%', padding: 6 }}
          />
          {fieldErrors.password && (
            <p style={{ color: 'red', margin: '4px 0 0' }}>{fieldErrors.password}</p>
          )}
        </div>
        {serverError && <p style={{ color: 'red' }}>{serverError}</p>}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Вход...' : 'Войти'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
      </p>
    </main>
  );
};
