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
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-card__header">
          <span className="logo__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6A1 1 0 0 1 4.3 19v-3.1A2.5 2.5 0 0 1 4 14.5v-9Z" />
            </svg>
          </span>
          <h1 className="auth-card__title">Вход в систему</h1>
          <p className="auth-card__subtitle">Корпоративный мессенджер</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="email">
              Корпоративный email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              placeholder="ivanov@corp.messenger.com"
              onChange={(event) => setEmail(event.target.value)}
            />
            {fieldErrors.email && <p className="field__error">{fieldErrors.email}</p>}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="password">
              Пароль
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              placeholder="••••••••"
              onChange={(event) => setPassword(event.target.value)}
            />
            {fieldErrors.password && <p className="field__error">{fieldErrors.password}</p>}
          </div>

          {serverError && <p className="form-error">{serverError}</p>}

          <button type="submit" className="button button--block" disabled={isSubmitting}>
            {isSubmitting ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <p className="auth-card__footer">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </main>
  );
};
