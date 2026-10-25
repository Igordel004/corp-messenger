import express from 'express';
import { prisma } from './data-access/prisma';
import { AuthService } from './services/auth';
import { MessageService } from './services/message';
import { ChannelService } from './services/channel';
import { createAuthRouter } from './controllers/auth';
import { createChannelRouter } from './controllers/channel';
import { createMessageRouter } from './controllers/message';
import { createAdminRouter } from './controllers/admin';
import { AdminService } from './services/admin';

export const app = express();
app.use(express.json());

app.locals.prisma = prisma;

export const messageService = new MessageService(prisma);

app.use('/api/auth', createAuthRouter(new AuthService(prisma)));

app.use('/api/channels', createChannelRouter(new ChannelService(prisma)));

app.use('/api/channels', createMessageRouter(messageService));

app.use('/api/admin', createAdminRouter(new AdminService(prisma), prisma));

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'corporate-messenger-api' });
});
