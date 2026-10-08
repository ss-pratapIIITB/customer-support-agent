import 'dotenv/config';
import { initializeDatabase, pool } from '../src/db.js';
import { runEvals } from '../src/evals.js';
try { await initializeDatabase(); const run=await runEvals(); console.log(JSON.stringify({id:run.id,summary:run.summary,error:run.error,auditStatus:run.auditStatus},null,2)); if(run.error)process.exitCode=1; }
catch(error){console.error(error instanceof Error?error.message:'Evaluation failed');process.exitCode=1;}
finally{await pool.end();}
