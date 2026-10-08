import { ingest } from '../src/rag.js';
import { pool } from '../src/db.js';
ingest({fault:process.argv.includes('--interrupt')?'ingestion_interrupt':undefined}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
