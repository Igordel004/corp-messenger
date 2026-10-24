import express, { type Request, type Response } from 'express';
import { requireAuth } from '../modules/middleware';
import { type MessageService } from '../services/message';

export const createMessageRouter = (messageService: MessageService): express.Router => {
  const router = express.Router();

  router.get('/:id/messages', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { id: channelId } = req.params as { id: string };
    const result = await messageService.list(channelId, req.session!.sub);

    switch (result.status) {
      case 'not_found':
        res.status(404).json({ message: 'Канал не найден' });
        return;
      case 'forbidden':
        res.status(403).json({ message: 'Лента сообщений доступна только участникам канала' });
        return;
      case 'ok':
        res.status(200).json(result.messages);
    }
  });

  return router;
};
