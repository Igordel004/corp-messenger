import { describe, it, expect } from 'vitest';
import { validateCorporateEmail, validatePassword } from './validation';

describe('Unit Test: Валидация учетных данных сотрудника', () => {
  it('должен принимать корректный корпоративный email', () => {
    expect(validateCorporateEmail('employee@corp.messenger.com')).toBe(true);
  });

  it('должен отклонять сторонний публичный email', () => {
    expect(validateCorporateEmail('user@gmail.com')).toBe(false);
  });

  it('должен проверять минимальную длину пароля (от 8 символов)', () => {
    expect(validatePassword('secretPass123')).toBe(true);
    expect(validatePassword('12345')).toBe(false);
  });
});
