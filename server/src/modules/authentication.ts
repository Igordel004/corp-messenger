import express, { type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { validateCorporateEmail } from '../utils/validation';
import { signSessionToken } from '../utils/token';
import { requireAuth } from './middleware';
import { type PrismaClient } from '../generated/prisma/client';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

// Тело запроса после проверки типов полей
interface ValidatedLoginInput {
  email: string;
  password: string;
}

// Проверка типов полей запроса (формат email проверяется вторым шагом)
const validateLoginFields = (body: LoginBody): ValidatedLoginInput | null => {
  const { email, password } = body;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return null;
  }
  return { email, password };
};

export const createAuthenticationRouter = (prisma: PrismaClient): express.Router => {
  const router = express.Router();

  // Аутентификация: выдача токена сессии по паре email и пароль
  router.post('/login', async (req: Request, res: Response): Promise<void> => {
    const input = validateLoginFields(req.body ?? {});
    if (!input || !validateCorporateEmail(input.email)) {
      res.status(400).json({ message: 'Некорректный корпоративный email' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    // Единый ответ для неверного email и неверного пароля,
    // чтобы не раскрывать существование учётной записи
    const passwordMatches =
      user !== null && (await bcrypt.compare(input.password, user.passwordHash));
    if (!passwordMatches) {
      res.status(401).json({ message: 'Неверный email или пароль' });
      return;
    }

    // Критерий 3: заблокированный аккаунт не может авторизоваться
    if (user.status === 'BLOCKED') {
      res.status(403).json({ message: 'Аккаунт заблокирован администратором' });
      return;
    }

    // Критерий 1: валидная пара даёт подписанный токен сессии
    const token = signSessionToken({ sub: user.id, role: user.globalRole });
    res.status(200).json({ token });
  });

  // Данные текущего пользователя: доступ только при валидном токене
  router.get('/me', requireAuth, async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.session!.sub },
      select: {
        id: true,
        fullName: true,
        email: true,
        globalRole: true,
        status: true,
      },
    });

    if (!user) {
      res.status(401).json({ message: 'Пользователь не найден' });
      return;
    }

    res.status(200).json(user);
  });

  return router;
};
