import bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { type GlobalRole, type AccountStatus } from '../generated/prisma/enums';
import { type PrismaClient } from '../generated/prisma/client';

export type TokenType = 'access' | 'refresh';

export interface TokenPayload {
  sub: string;
  role: GlobalRole;
  type: TokenType;
}

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL = '7d';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SALT_ROUNDS = 10;

const getJwtSecret = (): string => {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    throw new Error('Переменная окружения JWT_SECRET не задана');
  }
  return secret;
};

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

// jwtid делает каждый refresh-токен уникальным: без него токены,
// выпущенные в одну секунду, совпадали бы байт в байт и ротация стала бы невозможна
export const signAccessToken = (payload: Omit<TokenPayload, 'type'>): string =>
  signToken({ ...payload, type: 'access' }, ACCESS_TOKEN_TTL);

export const signRefreshToken = (payload: Omit<TokenPayload, 'type'>): string =>
  signToken({ ...payload, type: 'refresh' }, REFRESH_TOKEN_TTL, randomUUID());

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

export const verifyAccessToken = (token: string): TokenPayload => verifyToken(token, 'access');

export const verifyRefreshToken = (token: string): TokenPayload => verifyToken(token, 'refresh');

export function validateCorporateEmail(email: string): boolean {
  const corporateDomain = '@corp.messenger.com';
  return (
    typeof email === 'string' &&
    email.endsWith(corporateDomain) &&
    email.length > corporateDomain.length
  );
}

export function validatePassword(password: string): boolean {
  return typeof password === 'string' && password.length >= 8;
}

// В БД хранится только хэш: утечка записи не раскрывает сам токен
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export interface StoredRefreshToken {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export const storeRefreshToken = async (
  prisma: PrismaClient,
  userId: string,
  token: string,
): Promise<StoredRefreshToken> => {
  const record = await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return {
    id: record.id,
    userId: record.userId,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
  };
};

export const findRefreshToken = async (
  prisma: PrismaClient,
  token: string,
): Promise<StoredRefreshToken | null> => {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!record) {
    return null;
  }

  return {
    id: record.id,
    userId: record.userId,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
  };
};

export const isRefreshTokenUsable = (record: StoredRefreshToken): boolean =>
  record.revokedAt === null && record.expiresAt.getTime() > Date.now();

export const revokeRefreshToken = async (prisma: PrismaClient, tokenId: string): Promise<void> => {
  await prisma.refreshToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  });
};

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  globalRole: GlobalRole;
  status: AccountStatus;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface RegisterInput {
  fullName: unknown;
  email: unknown;
  password: unknown;
}

export interface LoginInput {
  email: unknown;
  password: unknown;
}

export type RegisterResult =
  | { status: 'created'; user: UserProfile }
  | { status: 'invalid'; message: string }
  | { status: 'email_taken' };

export type LoginResult =
  | { status: 'ok'; tokens: TokenPair }
  | { status: 'invalid' }
  | { status: 'invalid_credentials' }
  | { status: 'blocked' };

export type RefreshResult =
  | { status: 'ok'; tokens: TokenPair }
  | { status: 'missing_token' }
  | { status: 'invalid_token' }
  | { status: 'session_invalid' };

const toProfile = (user: {
  id: string;
  fullName: string;
  email: string;
  globalRole: GlobalRole;
  status: AccountStatus;
}): UserProfile => ({
  id: user.id,
  fullName: user.fullName,
  email: user.email,
  globalRole: user.globalRole,
  status: user.status,
});

// Ошибка уникальности Prisma (P2002) — email уже занят параллельной записью
const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    const { fullName, email, password } = input;
    if (typeof fullName !== 'string' || fullName.trim().length === 0) {
      return { status: 'invalid', message: 'Имя сотрудника обязательно для заполнения' };
    }
    if (typeof email !== 'string' || !validateCorporateEmail(email)) {
      return {
        status: 'invalid',
        message: 'Некорректный корпоративный email (домен @corp.messenger.com)',
      };
    }
    if (typeof password !== 'string' || !validatePassword(password)) {
      return { status: 'invalid', message: 'Пароль должен содержать не менее 8 символов' };
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return { status: 'email_taken' };
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: { fullName: fullName.trim(), email, passwordHash },
      });
      return { status: 'created', user: toProfile(user) };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return { status: 'email_taken' };
      }
      throw error;
    }
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const { email, password } = input;
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !validateCorporateEmail(email)
    ) {
      return { status: 'invalid' };
    }

    const user = await this.prisma.user.findUnique({ where: { email } });

    // Единый ответ для неверного email и неверного пароля,
    // чтобы не раскрывать существование учётной записи
    const passwordMatches = user !== null && (await bcrypt.compare(password, user.passwordHash));
    if (!passwordMatches) {
      return { status: 'invalid_credentials' };
    }

    if (user.status === 'BLOCKED') {
      return { status: 'blocked' };
    }

    return { status: 'ok', tokens: await this.issueTokenPair(user.id, user.globalRole) };
  }

  async refresh(refreshToken: unknown): Promise<RefreshResult> {
    if (typeof refreshToken !== 'string') {
      return { status: 'missing_token' };
    }

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return { status: 'invalid_token' };
    }

    const record = await findRefreshToken(this.prisma, refreshToken);
    if (!record || !isRefreshTokenUsable(record)) {
      return { status: 'session_invalid' };
    }

    // Роль и статус берутся из БД: данные токена могли устареть
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status === 'BLOCKED') {
      await revokeRefreshToken(this.prisma, record.id);
      return { status: 'session_invalid' };
    }

    await revokeRefreshToken(this.prisma, record.id);
    return { status: 'ok', tokens: await this.issueTokenPair(user.id, user.globalRole) };
  }

  async logout(refreshToken: unknown): Promise<void> {
    if (typeof refreshToken !== 'string') {
      return;
    }
    try {
      verifyRefreshToken(refreshToken);
      const record = await findRefreshToken(this.prisma, refreshToken);
      if (record && isRefreshTokenUsable(record)) {
        await revokeRefreshToken(this.prisma, record.id);
      }
    } catch {
      // Невалидный токен — отзывать нечего
    }
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        globalRole: true,
        status: true,
      },
    });
    return user;
  }

  private async issueTokenPair(userId: string, role: GlobalRole): Promise<TokenPair> {
    const accessToken = signAccessToken({ sub: userId, role });
    const refreshToken = signRefreshToken({ sub: userId, role });
    await storeRefreshToken(this.prisma, userId, refreshToken);
    return { accessToken, refreshToken };
  }
}
