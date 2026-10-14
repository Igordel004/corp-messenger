import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { registerEmployee, type RegisteredUser } from '../api/auth';
import { getApiErrorMessage } from '../api/client';

const CORPORATE_DOMAIN = '@corp.messenger.com';

// Локальные ошибки формы (проверяются до отправки на сервер)
interface FieldErrors {
  fullName?: string;
  email?: string;
  password?: string;
}

// Клиентская валидация полей формы регистрации
const validateRegisterForm = (fullName: string, email: string, password: string): FieldErrors => {
  const errors: FieldErrors = {};
  if (fullName.trim().length === 0) {
    errors.fullName = 'Введите имя сотрудника';
  }
  if (!email.includes(CORPORATE_DOMAIN)) {
    errors.email = `Разрешена только корпоративная почта (домен ${CORPORATE_DOMAIN})`;
  }
  if (password.length < 8) {
    errors.password = 'Пароль должен содержать не менее 8 символов';
  }
  return errors;
};

// Страница регистрации сотрудника
export const RegisterPage = () => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [successUser, setSuccessUser] = useState<RegisteredUser | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateRegisterForm(fullName, email, password);
    setFieldErrors(errors);
    setServerError(null);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const user = await registerEmployee({ fullName: fullName.trim(), email, password });
      setSuccessUser(user);
      setFullName('');
      setEmail('');
      setPassword('');
    } catch (error) {
      // Отображение ошибок сервера: занятый email (409), валидация (400)
      setServerError(getApiErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Экран успешной регистрации
  if (successUser) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-card__header">
            <span className="logo__mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
              </svg>
            </span>
            <h1 className="auth-card__title">Регистрация завершена</h1>
            <p className="auth-card__subtitle">Аккаунт сотрудника создан</p>
          </div>

          <div className="profile__tile" style={{ marginBottom: 16 }}>
            <p className="profile__tile-label">Сотрудник</p>
            <p className="profile__tile-value">{successUser.fullName}</p>
            <p className="profile__email" style={{ marginTop: 4 }}>
              {successUser.email}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <span className="badge badge--member">{successUser.globalRole}</span>
            <span
              className={`badge ${successUser.status === 'ACTIVE' ? 'badge--online' : 'badge--danger'}`}
            >
              {successUser.status === 'ACTIVE' ? 'Активен' : 'Заблокирован'}
            </span>
          </div>

          <button
            type="button"
            className="button button--secondary button--block"
            onClick={() => setSuccessUser(null)}
          >
            Зарегистрировать ещё одного сотрудника
          </button>

          <p className="auth-card__footer">
            <Link to="/login">Вернуться ко входу</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-card__header">
          <span className="logo__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M15 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-2.67 0-8 1.34-8 4v2h10.36a6.45 6.45 0 0 1-.36-2v-2.5A3.5 3.5 0 0 1 15 14Z" />
            </svg>
          </span>
          <h1 className="auth-card__title">Регистрация сотрудника</h1>
          <p className="auth-card__subtitle">Создание аккаунта в корпоративной системе</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="fullName">
              Имя и фамилия
            </label>
            <input
              id="fullName"
              type="text"
              className="input"
              value={fullName}
              placeholder="Иванов Иван"
              onChange={(event) => setFullName(event.target.value)}
            />
            {fieldErrors.fullName && <p className="field__error">{fieldErrors.fullName}</p>}
          </div>

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
              placeholder="Минимум 8 символов"
              onChange={(event) => setPassword(event.target.value)}
            />
            {fieldErrors.password && <p className="field__error">{fieldErrors.password}</p>}
          </div>

          {serverError && <p className="form-error">{serverError}</p>}

          <button type="submit" className="button button--block" disabled={isSubmitting}>
            {isSubmitting ? 'Регистрация...' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="auth-card__footer">
          Уже есть аккаунт? <Link to="/login">Войти в систему</Link>
        </p>
      </div>
    </main>
  );
};
