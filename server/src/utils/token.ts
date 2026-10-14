import jwt from 'jsonwebtoken';
import { GlobalRole } from '../generated/prisma/enums';

// Данные, закодированные в полезной нагрузке токена сессии
export interface SessionPayload {
  /** Идентификатор пользователя (sub — стандартное поле JWT) */
  sub: string;
  /** Глобальная роль пользователя для проверки прав на сервере */
  role: GlobalRole;
}

// Секрет подписи токенов берётся из окружения (см. server/.env)
const getJwtSecret = (): string => {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    throw new Error('Переменная окружения JWT_SECRET не задана');
  }
  return secret;
};

const TOKEN_TTL = '24h'; // время жизни токена сессии

// Создание подписанного токена сессии
export const signSessionToken = (payload: SessionPayload): string => {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_TTL });
};

// Верификация токена: бросает ошибку при невалидной подписи или истёкшем сроке
export const verifySessionToken = (token: string): SessionPayload => {
  const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
  if (typeof decoded.sub !== 'string' || typeof decoded.role !== 'string') {
    throw new Error('Некорректная полезная нагрузка токена');
  }
  return { sub: decoded.sub, role: decoded.role as GlobalRole };
};
