import { type PrismaClient } from '../generated/prisma/client';
import { type GlobalRole, type AccountStatus } from '../generated/prisma/enums';

export interface AdminUserRecord {
  id: string;
  fullName: string;
  email: string;
  globalRole: GlobalRole;
  status: AccountStatus;
}

export type UpdateUserResult =
  | { status: 'updated'; user: AdminUserRecord }
  | { status: 'not_found' }
  | { status: 'self_forbidden' };

const isRecordNotFound = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2025';

const USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  globalRole: true,
  status: true,
} as const;

export class AdminService {
  constructor(private readonly prisma: PrismaClient) {}

  async listUsers(search?: string): Promise<AdminUserRecord[]> {
    const query = search?.trim();

    const users = await this.prisma.user.findMany({
      where: query
        ? {
            OR: [
              { fullName: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: USER_SELECT,
      orderBy: { fullName: 'asc' },
    });

    return users;
  }

  async setUserStatus(
    initiatorId: string,
    userId: string,
    status: AccountStatus,
  ): Promise<UpdateUserResult> {
    if (initiatorId === userId) {
      return { status: 'self_forbidden' };
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { status },
        select: USER_SELECT,
      });
      return { status: 'updated', user };
    } catch (error) {
      if (isRecordNotFound(error)) {
        return { status: 'not_found' };
      }
      throw error;
    }
  }

  async setGlobalRole(
    initiatorId: string,
    userId: string,
    globalRole: GlobalRole,
  ): Promise<UpdateUserResult> {
    if (initiatorId === userId) {
      return { status: 'self_forbidden' };
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { globalRole },
        select: USER_SELECT,
      });
      return { status: 'updated', user };
    } catch (error) {
      if (isRecordNotFound(error)) {
        return { status: 'not_found' };
      }
      throw error;
    }
  }
}
