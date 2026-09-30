export interface ServerConfig {
  port: number;
  host: string;
}

export const startServer = (config: ServerConfig): void => {
  console.log(`Server starting on ${config.host}:${config.port}`);
};