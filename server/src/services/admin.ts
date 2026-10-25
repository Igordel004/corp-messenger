import { type PrismaClient } from '../generated/prisma/client';
import { type GlobalRole, type AccountStatus } from '../generated/prisma/enums';

export interface AdminUserRecord {
  id: string;
  fullName: string;
  email: string;
  globalRole: GlobalRole;
  status: AccountStatus;
}

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
      select: {
        id: true,
        fullName: true,
        email: true,
        globalRole: true,
        status: true,
      },
      orderBy: { fullName: 'asc' },
    });

    return users;
  }
}
