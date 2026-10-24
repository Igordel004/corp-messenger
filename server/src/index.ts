import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { app } from './app';
import { prisma } from './db';
import { createRealtimeHub } from './modules/realtime';

export interface ServerConfig {
  port: number;
  host: string;
}

export const startServer = (config: ServerConfig): void => {
  // WebSocket-сервер обслуживается на том же порту, что и REST API
  const httpServer = createServer(app);
  const hub = createRealtimeHub(prisma);
  const wsServer = new WebSocketServer({ server: httpServer, path: '/ws' });

  wsServer.on('connection', (socket, request) => {
    hub.handleConnection(socket, request);
  });

  httpServer.listen(config.port, config.host, () => {
    console.log(
      `Сервер корпоративного мессенджера запущен на http://${config.host}:${config.port}`,
    );
  });
};

const config: ServerConfig = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
};

startServer(config);
