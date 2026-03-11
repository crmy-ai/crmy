import { Command } from 'commander';
import { loadConfigFile } from '../config.js';

export function serverCommand(): Command {
  return new Command('server')
    .description('Start the crmy HTTP server')
    .option('--port <port>', 'HTTP port', '3000')
    .action(async (opts) => {
      const config = loadConfigFile();

      process.env.DATABASE_URL = config.database?.url ?? process.env.DATABASE_URL;
      process.env.JWT_SECRET = config.jwtSecret ?? process.env.JWT_SECRET ?? 'dev-secret';
      process.env.PORT = opts.port;
      process.env.CRMY_IMPORTED = '1';

      if (!process.env.DATABASE_URL) {
        console.error('No database URL. Run `crmy-ai init` first or set DATABASE_URL.');
        process.exit(1);
      }

      const { createApp, loadConfig } = await import('@crmy/server');
      const serverConfig = loadConfig();
      const { app } = await createApp(serverConfig);

      app.listen(serverConfig.port, () => {
        console.log(`crmy server ready on :${serverConfig.port}`);
      });
    });
}
