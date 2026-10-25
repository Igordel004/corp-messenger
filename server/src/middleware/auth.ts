import { type Request, type Response, type NextFunction } from 'express';
import { type PrismaClient } from '../generated/prisma/client';
import { verifyAccessToken, type TokenPayload } from '../services/auth';

declare module 'express-serve-static-core' {
  interface Request {
    session?: TokenPayload;
  }
}

const BEARER_PREFIX = 'Bearer ';

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    res.status(401).json({ message: 'Требуется авторизация' });
    return;
  }

  try {
    req.session = verifyAccessToken(header.slice(BEARER_PREFIX.length));
    next();
  } catch {
    res.status(401).json({ message: 'Невалидный или истёкший токен' });
  }
};

export const createRequireAdmin =
  (prisma: PrismaClient) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = await prisma.user.findUnique({
      where: { id: req.session!.sub },
      select: { globalRole: true },
    });

    if (user?.globalRole !== 'ADMIN') {
      res.status(403).json({ message: 'Доступ запрещён: требуется роль администратора' });
      return;
    }
    next();
  };
