import express, { type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { type AdminService } from '../services/admin';

export const createAdminRouter = (adminService: AdminService): express.Router => {
  const router = express.Router();

  router.get('/users', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const { search } = req.query as { search?: unknown };
    const users = await adminService.listUsers(typeof search === 'string' ? search : undefined);
    res.status(200).json(users);
  });

  return router;
};
