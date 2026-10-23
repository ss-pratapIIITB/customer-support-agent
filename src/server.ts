// Telemetry must start before Express, pg, and HTTP modules are loaded so the
// auto-instrumentations can patch them.
import { startTelemetry, shutdownTelemetry } from './telemetry.js';

startTelemetry();

const { config } = await import('./config.js');
const { logger } = await import('./logger.js');
const { createApp } = await import('./app.js');
const { initializeDatabase, closeDatabase, query } = await import('./db.js');
const { bootstrap } = await import('./bootstrap.js');

await initializeDatabase();
await query(
  `UPDATE requests SET status='interrupted', error='Application restarted. Retry this message.', updated_at=now()
    WHERE status IN ('running','pending')`,
);
await query(`UPDATE messages SET status='interrupted' WHERE status IN ('running','pending')`);
await query(
  `UPDATE eval_runs SET status='interrupted', finished_at=now()
    WHERE status='running' AND created_at < now() - interval '1 minute'`,
);

await bootstrap();

const app = createApp();
const server = app.listen(config.PORT, config.APP_HOST, () => {
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  logger.info(
    {
      url: `http://${config.APP_HOST}:${config.PORT}`,
      mode: config.liveModel ? 'live' : 'demo',
      model: config.liveModel ? config.CHAT_MODEL : 'demo-engine',
      otel: config.OTEL_ENABLED,
    },
    'Maxify Support is ready',
  );
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await closeDatabase().catch(() => undefined);
    await shutdownTelemetry().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  logger.error({ err: error }, 'Unhandled rejection');
});
