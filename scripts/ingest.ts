import { initializeDatabase, closeDatabase } from '../src/db.js';
import { ingest } from '../src/ingest.js';

try {
  await initializeDatabase();
  const result = await ingest({
    fault: process.argv.includes('--interrupt') ? 'ingestion_interrupt' : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
