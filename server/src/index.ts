import { createHttpServer } from './app';

export interface ServerConfig {
  port: number;
  host: string;
}

export const startServer = (config: ServerConfig): void => {
  const httpServer = createHttpServer();

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
