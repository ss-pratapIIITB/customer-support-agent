import { bootstrap } from '../src/bootstrap.js';
import { closeDatabase } from '../src/db.js';

try {
  await bootstrap();
  console.log('Bootstrap complete');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
