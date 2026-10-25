import express, { type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { type AuthService, type RegisterInput, type LoginInput } from '../services/auth';

export const createAuthRouter = (authService: AuthService): express.Router => {
  const router = express.Router();

  router.post('/register', async (req: Request, res: Response): Promise<void> => {
    const result = await authService.register((req.body ?? {}) as RegisterInput);

    switch (result.status) {
      case 'invalid':
        res.status(400).json({ message: result.message });
        return;
      case 'email_taken':
        res.status(409).json({ message: 'Email уже зарегистрирован' });
        return;
      case 'created':
        res.status(201).json(result.user);
    }
  });

  router.post('/login', async (req: Request, res: Response): Promise<void> => {
    const result = await authService.login((req.body ?? {}) as LoginInput);

    switch (result.status) {
      case 'invalid':
        res.status(400).json({ message: 'Некорректный корпоративный email' });
        return;
      case 'invalid_credentials':
        res.status(401).json({ message: 'Неверный email или пароль' });
        return;
      case 'blocked':
        res.status(403).json({ message: 'Аккаунт заблокирован администратором' });
        return;
      case 'ok':
        res.status(200).json(result.tokens);
    }
  });

  router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { refreshToken?: unknown };
    const result = await authService.refresh(body.refreshToken);

    switch (result.status) {
      case 'missing_token':
        res.status(400).json({ message: 'Требуется refresh-токен' });
        return;
      case 'invalid_token':
        res.status(401).json({ message: 'Невалидный или истёкший токен' });
        return;
      case 'session_invalid':
        res.status(401).json({ message: 'Сессия недействительна' });
        return;
      case 'ok':
        res.status(200).json(result.tokens);
    }
  });

  router.post('/logout', async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { refreshToken?: unknown };
    await authService.logout(body.refreshToken);
    res.status(200).json({ message: 'Сессия завершена' });
  });

  router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const user = await authService.getProfile(req.session!.sub);

    if (!user) {
      res.status(401).json({ message: 'Пользователь не найден' });
      return;
    }

    res.status(200).json(user);
  });

  return router;
};
