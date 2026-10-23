import { config } from './config.js';
import { initializeDatabase } from './db.js';
import { ingest, getIngestionStatus } from './ingest.js';
import { ensureUsers, seedDemo } from './seed.js';
import { logger } from './logger.js';

export async function bootstrap(): Promise<void> {
  await initializeDatabase();
  await ensureUsers();
  if (!config.AUTO_BOOTSTRAP) return;

  const status = await getIngestionStatus();
  if (!status.ready) {
    logger.info('No active corpus found; ingesting preserved snapshots');
    const result = await ingest();
    logger.info(result, 'Initial ingestion complete');
  }
  if (config.SEED_DEMO) {
    const seeded = await seedDemo();
    if (seeded.skipped) logger.debug({ chats: seeded.seeded }, 'Demo workspace already seeded');
  }
}
