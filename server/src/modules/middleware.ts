import { type Request, type Response, type NextFunction } from 'express';
import { verifyAccessToken, type TokenPayload } from '../utils/token';

// Расширение типа запроса Express: payload сессии после прохождения проверки
declare module 'express-serve-static-core' {
  interface Request {
    session?: TokenPayload;
  }
}

const BEARER_PREFIX = 'Bearer ';

// Middleware проверки токена сессии в заголовке Authorization.
// При успехе прикрепляет payload к req.session и передаёт управление дальше,
// при отсутствии или невалидном токене отвечает 401.
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
