import express, { type Request, type Response } from 'express';
import { requireAuth } from '../modules/middleware';
import { type ChannelService } from '../services/channel';
import { ChannelRole, ChannelType } from '../generated/prisma/enums';

const MIN_NAME_LENGTH = 3;

const isChannelType = (value: unknown): value is ChannelType =>
  value === ChannelType.PUBLIC || value === ChannelType.PRIVATE;

const validateChannelInput = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) {
    return 'Тело запроса должно содержать название и тип канала';
  }
  const { name, type } = body as { name?: unknown; type?: unknown };
  if (typeof name !== 'string' || name.trim().length < MIN_NAME_LENGTH) {
    return `Название канала должно содержать не менее ${MIN_NAME_LENGTH} символов`;
  }
  if (!isChannelType(type)) {
    return 'Тип канала должен быть PUBLIC или PRIVATE';
  }
  return null;
};

export const createChannelRouter = (channelService: ChannelService): express.Router => {
  const router = express.Router();

  router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const validationError = validateChannelInput(req.body);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const body = req.body as { name: string; type: ChannelType };
    const channel = await channelService.createWithOwner({
      name: body.name.trim(),
      type: body.type,
      creatorId: req.session!.sub,
    });

    res.status(201).json({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      role: 'OWNER',
    });
  });

  router.get('/', requireAuth, async (req: Request, res: Response) => {
    const channels = await channelService.listUserChannels(req.session!.sub);
    res.status(200).json(channels);
  });

  router.get('/catalog', requireAuth, async (req: Request, res: Response) => {
    const channels = await channelService.listCatalog(req.session!.sub);
    res.status(200).json(channels);
  });

  router.post('/:id/join', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { id: channelId } = req.params as { id: string };
    const result = await channelService.join(channelId, req.session!.sub);

    switch (result.status) {
      case 'not_found':
        res.status(404).json({ message: 'Канал не найден' });
        return;
      case 'private':
        res.status(400).json({ message: 'Вступить можно только в публичный канал' });
        return;
      case 'already_member':
        res.status(409).json({ message: 'Вы уже являетесь участником канала' });
        return;
      case 'joined':
        res.status(201).json({ ...result.channel, role: 'MEMBER' });
    }
  });

  router.get('/:id/members', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { id: channelId } = req.params as { id: string };
    const result = await channelService.listMembers(channelId, req.session!.sub);

    switch (result.status) {
      case 'not_found':
        res.status(404).json({ message: 'Канал не найден' });
        return;
      case 'forbidden':
        res.status(403).json({ message: 'Список участников доступен только участникам канала' });
        return;
      case 'ok':
        res.status(200).json(result.members);
    }
  });

  router.post('/:id/members', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { id: channelId } = req.params as { id: string };
    const body = (req.body ?? {}) as { email?: unknown };

    if (typeof body.email !== 'string') {
      res.status(400).json({ message: 'Требуется email сотрудника' });
      return;
    }

    const result = await channelService.addMember(channelId, req.session!.sub, body.email);

    switch (result.status) {
      case 'not_found':
        res.status(404).json({ message: 'Канал не найден' });
        return;
      case 'user_not_found':
        res.status(404).json({ message: 'Сотрудник с таким email не найден' });
        return;
      case 'forbidden':
        res.status(403).json({
          message: 'Добавлять участников может только владелец или модератор',
        });
        return;
      case 'already_member':
        res.status(409).json({ message: 'Пользователь уже является участником канала' });
        return;
      case 'added':
        res.status(201).json(result.member);
    }
  });

  router.delete(
    '/:id/members/:userId',
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { id: channelId, userId } = req.params as { id: string; userId: string };
      const result = await channelService.removeMember(channelId, req.session!.sub, userId);

      switch (result.status) {
        case 'not_found':
          res.status(404).json({ message: 'Канал не найден' });
          return;
        case 'forbidden':
          res.status(403).json({ message: 'Исключать участников может только владелец' });
          return;
        case 'target_not_found':
          res.status(404).json({ message: 'Участник не найден в этом канале' });
          return;
        case 'owner_protected':
          res.status(400).json({ message: 'Владелец канала не может быть исключён' });
          return;
        case 'removed':
          res.status(200).json({ message: 'Участник исключён из канала' });
          return;
        case 'left':
          res.status(200).json({ message: 'Вы вышли из канала' });
      }
    },
  );

  router.patch(
    '/:id/members/:userId/role',
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { id: channelId, userId } = req.params as { id: string; userId: string };
      const body = (req.body ?? {}) as { role?: unknown };

      if (body.role !== ChannelRole.MEMBER && body.role !== ChannelRole.MODERATOR) {
        res.status(400).json({ message: 'Роль должна быть MEMBER или MODERATOR' });
        return;
      }

      const result = await channelService.changeMemberRole(
        channelId,
        req.session!.sub,
        userId,
        body.role,
      );

      switch (result.status) {
        case 'not_found':
          res.status(404).json({ message: 'Канал не найден' });
          return;
        case 'forbidden':
          res.status(403).json({ message: 'Менять роли участников может только владелец' });
          return;
        case 'target_not_found':
          res.status(404).json({ message: 'Участник не найден в этом канале' });
          return;
        case 'owner_protected':
          res.status(400).json({ message: 'Роль владельца канала изменить нельзя' });
          return;
        case 'role_unchanged':
          res.status(409).json({ message: 'Участник уже имеет эту роль' });
          return;
        case 'changed':
          res.status(200).json({ userId, role: result.role });
      }
    },
  );

  return router;
};
