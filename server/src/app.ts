import express from 'express';
import { prisma } from './db';
import { createAuthRouter } from './modules/registration';
import { createAuthenticationRouter } from './modules/authentication';

export const app = express();
app.use(express.json());

// Доступ к базе данных из любых обработчиков через req.app.locals.prisma
app.locals.prisma = prisma;

// Маршруты аутентификации и регистрации
app.use('/api/auth', createAuthRouter(prisma));
app.use('/api/auth', createAuthenticationRouter(prisma));

// Системный эндпоинт проверки работоспособности сервиса
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'corporate-messenger-api' });
});
