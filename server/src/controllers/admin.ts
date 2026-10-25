import express, { type Request, type Response } from 'express';
import { type PrismaClient } from '../generated/prisma/client';
import { requireAuth, createRequireAdmin } from '../middleware/auth';
import { type AdminService, type UpdateUserResult } from '../services/admin';
import { GlobalRole, AccountStatus } from '../generated/prisma/enums';

const isGlobalRole = (value: unknown): value is GlobalRole =>
  value === GlobalRole.USER || value === GlobalRole.ADMIN;

const isAccountStatus = (value: unknown): value is AccountStatus =>
  value === AccountStatus.ACTIVE || value === AccountStatus.BLOCKED;

const respondWithUserResult = (res: Response, result: UpdateUserResult): void => {
  switch (result.status) {
    case 'not_found':
      res.status(404).json({ message: 'Сотрудник не найден' });
      return;
    case 'self_forbidden':
      res.status(403).json({ message: 'Действия над собственной учётной записью запрещены' });
      return;
    case 'updated':
      res.status(200).json(result.user);
  }
};

export const createAdminRouter = (
  adminService: AdminService,
  prisma: PrismaClient,
): express.Router => {
  const router = express.Router();
  const requireAdmin = createRequireAdmin(prisma);

  router.get('/users', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const { search } = req.query as { search?: unknown };
    const users = await adminService.listUsers(typeof search === 'string' ? search : undefined);
    res.status(200).json(users);
  });

  router.patch(
    '/users/:id/status',
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { status?: unknown };

      if (!isAccountStatus(body.status)) {
        res.status(400).json({ message: 'Статус должен быть ACTIVE или BLOCKED' });
        return;
      }

      const result = await adminService.setUserStatus(req.session!.sub, id, body.status);
      respondWithUserResult(res, result);
    },
  );

  router.patch(
    '/users/:id/role',
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { globalRole?: unknown };

      if (!isGlobalRole(body.globalRole)) {
        res.status(400).json({ message: 'Роль должна быть USER или ADMIN' });
        return;
      }

      const result = await adminService.setGlobalRole(req.session!.sub, id, body.globalRole);
      respondWithUserResult(res, result);
    },
  );

  return router;
};
