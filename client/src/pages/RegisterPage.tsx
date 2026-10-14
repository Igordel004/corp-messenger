import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { registerEmployee, type RegisteredUser } from '../api/auth';
import { getApiErrorMessage } from '../api/client';

// Локальные ошибки формы (проверяются до отправки на сервер)
interface FieldErrors {
  fullName?: string;
  email?: string;
  password?: string;
}

const CORPORATE_DOMAIN = '@corp.messenger.com';

// Клиентская валидация полей формы
const validateForm = (fullName: string, email: string, password: string): FieldErrors => {
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

    const errors = validateForm(fullName, email, password);
    setFieldErrors(errors);
    setServerError(null);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const user = await registerEmployee({
        fullName: fullName.trim(),
        email,
        password,
      });
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
      <main style={{ maxWidth: 420, margin: '40px auto', fontFamily: 'sans-serif' }}>
        <h1>Регистрация завершена</h1>
        <p>
          Сотрудник <strong>{successUser.fullName}</strong> ({successUser.email}) зарегистрирован.
          Роль: {successUser.globalRole}, статус: {successUser.status}.
        </p>
        <button type="button" onClick={() => setSuccessUser(null)}>
          Зарегистрировать ещё одного сотрудника
        </button>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 420, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h1>Регистрация сотрудника</h1>
      <form onSubmit={handleSubmit} noValidate>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="fullName">Имя и фамилия</label>
          <br />
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            style={{ width: '100%', padding: 6 }}
          />
          {fieldErrors.fullName && (
            <p style={{ color: 'red', margin: '4px 0 0' }}>{fieldErrors.fullName}</p>
          )}
        </div>
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
          {isSubmitting ? 'Регистрация...' : 'Зарегистрироваться'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        Уже есть аккаунт? <Link to="/login">Войти в систему</Link>
      </p>
    </main>
  );
};
