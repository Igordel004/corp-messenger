import express, { type Request, type Response } from 'express';
import { requireAuth } from './middleware';
import { createChannelWithOwner } from './channels';
import { ChannelType } from '../generated/prisma/enums';
import { type PrismaClient } from '../generated/prisma/client';

const MIN_NAME_LENGTH = 3;

// Проверка типа приватности: значение должно быть одним из enum схемы
const isChannelType = (value: unknown): value is ChannelType =>
  value === ChannelType.PUBLIC || value === ChannelType.PRIVATE;

// Возвращает текст ошибки валидации или null, если данные корректны
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

export const createChannelRouter = (prisma: PrismaClient): express.Router => {
  const router = express.Router();

  // Создание канала: автор — пользователь из токена сессии
  router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const validationError = validateChannelInput(req.body);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const body = req.body as { name: string; type: ChannelType };
    const channel = await createChannelWithOwner(prisma, {
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

  return router;
};
