import { initializeDatabase, closeDatabase } from '../src/db.js';
import { ingest, getIngestionStatus } from '../src/ingest.js';
import { ensureUsers, seedDemo } from '../src/seed.js';

try {
  await initializeDatabase();
  await ensureUsers();
  if (!(await getIngestionStatus()).ready) {
    console.log('Ingesting corpus first…');
    console.log(await ingest());
  }
  const result = await seedDemo({ force: process.argv.includes('--force') });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
