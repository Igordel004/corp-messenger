import express, { type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { validateCorporateEmail, validatePassword } from '../utils/validation';
import { type PrismaClient } from '../generated/prisma/client';

// Количество раундов соли bcrypt (рекомендуемый минимум для продакшена)
const SALT_ROUNDS = 10;

interface RegisterBody {
  fullName?: unknown;
  email?: unknown;
  password?: unknown;
}

// Тело запроса после успешной валидации: все поля гарантированно строки
interface ValidatedRegisterInput {
  fullName: string;
  email: string;
  password: string;
}

// Возвращает текст ошибки валидации или null, если данные корректны
const validateRegisterInput = (body: RegisterBody): string | null => {
  const { fullName, email, password } = body;
  if (typeof fullName !== 'string' || fullName.trim().length === 0) {
    return 'Имя сотрудника обязательно для заполнения';
  }
  if (typeof email !== 'string' || !validateCorporateEmail(email)) {
    return 'Некорректный корпоративный email (домен @corp.messenger.com)';
  }
  if (typeof password !== 'string' || !validatePassword(password)) {
    return 'Пароль должен содержать не менее 8 символов';
  }
  return null;
};

// Ошибка уникальности Prisma (P2002) — email уже занят параллельной записью
const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

export const createAuthRouter = (prisma: PrismaClient): express.Router => {
  const router = express.Router();

  // Регистрация нового сотрудника
  router.post('/register', async (req: Request, res: Response): Promise<void> => {
    const validationError = validateRegisterInput(req.body ?? {});
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const body = req.body as ValidatedRegisterInput;
    const fullName = body.fullName.trim();
    const email = body.email;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(409).json({ message: 'Email уже зарегистрирован' });
      return;
    }

    // Пароль хэшируется с солью: в БД открытый пароль не сохраняется
    const passwordHash = await bcrypt.hash(body.password, SALT_ROUNDS);

    try {
      // Роль USER и статус ACTIVE назначаются дефолтами схемы БД
      const user = await prisma.user.create({
        data: { fullName, email, passwordHash },
      });

      res.status(201).json({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        globalRole: user.globalRole,
        status: user.status,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        res.status(409).json({ message: 'Email уже зарегистрирован' });
        return;
      }
      throw error;
    }
  });

  return router;
};
