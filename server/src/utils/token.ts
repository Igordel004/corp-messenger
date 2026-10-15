import jwt, { type SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { GlobalRole } from '../generated/prisma/enums';

// Тип токена: закодирован в нагрузке, проверяется при верификации.
// Access-токен подтверждает запросы API, refresh — только обновление пары.
export type TokenType = 'access' | 'refresh';

// Данные, закодированные в полезной нагрузке токена
export interface TokenPayload {
  /** Идентификатор пользователя (sub — стандартное поле JWT) */
  sub: string;
  /** Глобальная роль пользователя для проверки прав на сервере */
  role: GlobalRole;
  /** Вид токена */
  type: TokenType;
}

// Секрет подписи токенов берётся из окружения (см. server/.env)
const getJwtSecret = (): string => {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    throw new Error('Переменная окружения JWT_SECRET не задана');
  }
  return secret;
};

// Время жизни пары токенов по ТЗ задачи аутентификации
export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL = '7d';

// Создание подписанного токена указанного вида.
// jwtid добавляет уникальный идентификатор jti в нагрузку: без него
// токены с одинаковыми данными, выпущенные в одну секунду, совпадают
// байт в байт, и ротация refresh-токенов становится невозможна.
const signToken = (
  payload: TokenPayload,
  ttl: SignOptions['expiresIn'],
  jwtid?: string,
): string => {
  const options: SignOptions = { expiresIn: ttl };
  if (jwtid !== undefined) {
    options.jwtid = jwtid;
  }
  return jwt.sign(payload, getJwtSecret(), options);
};

// Короткоживущий токен доступа (15 минут)
export const signAccessToken = (payload: Omit<TokenPayload, 'type'>): string => {
  return signToken({ ...payload, type: 'access' }, ACCESS_TOKEN_TTL);
};

// Долгоживущий токен обновления (7 дней), каждый экземпляр уникален
export const signRefreshToken = (payload: Omit<TokenPayload, 'type'>): string => {
  return signToken({ ...payload, type: 'refresh' }, REFRESH_TOKEN_TTL, randomUUID());
};

// Верификация токена: бросает ошибку при невалидной подписи,
// истёкшем сроке или неожиданном виде токена
const verifyToken = (token: string, expectedType: TokenType): TokenPayload => {
  const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
  if (
    typeof decoded.sub !== 'string' ||
    typeof decoded.role !== 'string' ||
    decoded.type !== expectedType
  ) {
    throw new Error('Некорректная полезная нагрузка токена');
  }
  return { sub: decoded.sub, role: decoded.role as GlobalRole, type: expectedType };
};

// Проверка токена доступа: принимается только токен вида access
export const verifyAccessToken = (token: string): TokenPayload => {
  return verifyToken(token, 'access');
};

// Проверка токена обновления: принимается только токен вида refresh
export const verifyRefreshToken = (token: string): TokenPayload => {
  return verifyToken(token, 'refresh');
};
