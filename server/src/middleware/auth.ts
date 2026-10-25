import { type Request, type Response, type NextFunction } from 'express';
import { verifyAccessToken, type TokenPayload } from '../services/auth';

// Расширение типа запроса Express: payload сессии после прохождения проверки
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
