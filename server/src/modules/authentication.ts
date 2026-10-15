import express, { type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { validateCorporateEmail } from '../utils/validation';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/token';
import {
  storeRefreshToken,
  findRefreshToken,
  isRefreshTokenUsable,
  revokeRefreshToken,
} from './refresh-tokens';
import { requireAuth } from './middleware';
import { type PrismaClient } from '../generated/prisma/client';

// Тело запроса аутентификации
interface LoginBody {
  email?: unknown;
  password?: unknown;
}

// Тело запроса с refresh-токеном (обновление сессии и выход)
interface RefreshBody {
  refreshToken?: unknown;
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

// Выпуск новой пары токенов и сохранение refresh-токена в БД
const issueTokenPair = async (
  prisma: PrismaClient,
  userId: string,
  role: 'USER' | 'ADMIN',
): Promise<{ accessToken: string; refreshToken: string }> => {
  const accessToken = signAccessToken({ sub: userId, role });
  const refreshToken = signRefreshToken({ sub: userId, role });
  await storeRefreshToken(prisma, userId, refreshToken);
  return { accessToken, refreshToken };
};

export const createAuthenticationRouter = (prisma: PrismaClient): express.Router => {
  const router = express.Router();

  // Аутентификация: валидная пара email и пароль даёт пару токенов
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

    // Выдаётся пара: короткоживущий access и долгоживущий refresh
    const tokens = await issueTokenPair(prisma, user.id, user.globalRole);
    res.status(200).json(tokens);
  });

  // Обновление сессии: ротация пары токенов
  router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as RefreshBody;
    if (typeof body.refreshToken !== 'string') {
      res.status(400).json({ message: 'Требуется refresh-токен' });
      return;
    }

    let payload;
    try {
      payload = verifyRefreshToken(body.refreshToken);
    } catch {
      res.status(401).json({ message: 'Невалидный или истёкший токен' });
      return;
    }

    const record = await findRefreshToken(prisma, body.refreshToken);
    if (!record || !isRefreshTokenUsable(record)) {
      res.status(401).json({ message: 'Сессия недействительна' });
      return;
    }

    // Роль и статус берутся из БД: данные токена могли устареть
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status === 'BLOCKED') {
      await revokeRefreshToken(prisma, record.id);
      res.status(401).json({ message: 'Сессия недействительна' });
      return;
    }

    // Ротация: старый refresh отзывается, выдаётся новая пара
    await revokeRefreshToken(prisma, record.id);
    const tokens = await issueTokenPair(prisma, user.id, user.globalRole);
    res.status(200).json(tokens);
  });

  // Выход из системы: отзыв refresh-токена, access перестаёт обновляться
  router.post('/logout', async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as RefreshBody;
    if (typeof body.refreshToken === 'string') {
      try {
        verifyRefreshToken(body.refreshToken);
        const record = await findRefreshToken(prisma, body.refreshToken);
        if (record && isRefreshTokenUsable(record)) {
          await revokeRefreshToken(prisma, record.id);
        }
      } catch {
        // Невалидный токен — отзывать нечего, выход всё равно успешен
      }
    }

    res.status(200).json({ message: 'Сессия завершена' });
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
