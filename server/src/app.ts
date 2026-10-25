import express from 'express';
import { prisma } from './data-access/prisma';
import { AuthService } from './services/auth';
import { MessageService } from './services/message';
import { ChannelService } from './services/channel';
import { createAuthRouter } from './controllers/auth';
import { createChannelRouter } from './controllers/channel';
import { createMessageRouter } from './controllers/message';

export const app = express();
app.use(express.json());

// Доступ к базе данных из любых обработчиков через req.app.locals.prisma
app.locals.prisma = prisma;

// Маршруты аутентификации и регистрации
app.use('/api/auth', createAuthRouter(new AuthService(prisma)));

// Маршруты каналов (требуют валидный токен сессии)
app.use('/api/channels', createChannelRouter(new ChannelService(prisma)));

// Маршруты сообщений (требуют валидный токен сессии)
app.use('/api/channels', createMessageRouter(new MessageService(prisma)));

// Системный эндпоинт проверки работоспособности сервиса
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'corporate-messenger-api' });
});
