import 'dotenv/config';
import express from 'express';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {query,pool,initializeDatabase} from './db.js';
import {retrieve,ingest,listSources,getIngestionStatus} from './rag.js';
import {resolveRetrievalScope} from './context.js';
import {collectCosts,getCostSummary,getTraces} from './costs.js';
import {generateAnswer} from './agent.js';
import {hashPassword,verifyPassword,sessionIdFromCookie} from './auth.js';
import type {Passage} from './contracts.js';
const app=express();app.use(express.json({limit:'100kb'}));
const port=Number(process.env.PORT||3000);
let evalRunning=false,ingestionRunning=false;
async function boot(){
 await initializeDatabase();
 await query('ALTER TABLE requests ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0');
 await query(`CREATE TABLE IF NOT EXISTS model_calls(id text PRIMARY KEY,request_id text,purpose text,model text,cost_usd double precision,usage jsonb,data jsonb,created_at timestamptz DEFAULT now());CREATE INDEX IF NOT EXISTS model_calls_request ON model_calls(request_id);CREATE TABLE IF NOT EXISTS failure_results(id text PRIMARY KEY,data jsonb,created_at timestamptz DEFAULT now())`);
 await query('ALTER TABLE model_calls ADD COLUMN IF NOT EXISTS attempt_id text;ALTER TABLE model_calls ADD COLUMN IF NOT EXISTS chat_id text;ALTER TABLE model_calls ADD COLUMN IF NOT EXISTS eval_run_id text;');
 for(const [email,role] of [['customer@maxify.demo','customer'],['reviewer@maxify.demo','reviewer']])await query('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING',[randomUUID(),email,hashPassword('Demo123!'),role]);
 await query("UPDATE requests SET status='interrupted',error='Application restarted. Retry this message.',updated_at=now() WHERE status IN ('running','pending')");
 await query("UPDATE messages SET status='interrupted' WHERE status IN ('running','pending')");
}
app.use('/api',async(req,res,next)=>{
 if(req.method!=='GET'&&req.headers.origin){try{if(new URL(req.headers.origin).hostname!==req.hostname){res.status(403).json({error:'Origin is not permitted'});return;}}catch{res.status(403).json({error:'Invalid origin'});return;}}
 if(['/login','/health'].includes(req.path)){next();return;}
 const sid=sessionIdFromCookie(req.headers.cookie);if(!sid){res.status(401).json({error:'Please log in'});return;}
 const r=await query('SELECT u.id,u.email,u.role FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now()',[sid]);
 if(!r.rowCount){res.status(401).json({error:'Your session expired. Please log in.'});return;}
 res.locals.user=r.rows[0];if(req.path.startsWith('/admin')&&r.rows[0].role!=='reviewer'){res.status(403).json({error:'Reviewer access required'});return;}next();
});
app.get('/api/health',async(_req,res)=>{await query('SELECT 1');res.json({status:'ready',runtime:'codex-sdk',model:'gpt-6-luna',ingestion:await getIngestionStatus()});});
app.post('/api/login',async(req,res)=>{
 const {email,password}=req.body;if(typeof email!=='string'||typeof password!=='string'){res.status(400).json({error:'Email and password are required'});return;}
 const r=await query('SELECT * FROM users WHERE email=$1',[email.toLowerCase().trim()]);
 if(!r.rowCount||!verifyPassword(password,r.rows[0].password_hash)){res.status(401).json({error:'Email or password is incorrect'});return;}
 const user=r.rows[0],sid=randomUUID();await query("INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[sid,user.id]);
 res.cookie('support_session',sid,{httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='true',maxAge:8*3600*1000});
 let chat=(await query('SELECT id FROM chats WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[user.id])).rows[0];
 if(!chat){chat={id:randomUUID()};await query('INSERT INTO chats(id,user_id,title) VALUES($1,$2,$3)',[chat.id,user.id,'New conversation']);}
 res.json({user:{id:user.id,email:user.email,role:user.role},chatId:chat.id});
});
app.post('/api/logout',async(req,res)=>{await query('DELETE FROM auth_sessions WHERE id=$1',[sessionIdFromCookie(req.headers.cookie)]);res.clearCookie('support_session');res.json({ok:true});});
app.get('/api/me',async(_req,res)=>{const chat=(await query('SELECT id FROM chats WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[res.locals.user.id])).rows[0];res.json({user:res.locals.user,chatId:chat?.id});});
app.get('/api/chats',async(_req,res)=>res.json({chats:(await query('SELECT id,title,created_at FROM chats WHERE user_id=$1 ORDER BY created_at DESC',[res.locals.user.id])).rows}));
app.post('/api/chats',async(_req,res)=>{const id=randomUUID();await query('INSERT INTO chats(id,user_id,title) VALUES($1,$2,$3)',[id,res.locals.user.id,'New conversation']);res.json({chat:{id,title:'New conversation'}});});
async function ownedChat(id:string,userId:string){return (await query('SELECT * FROM chats WHERE id=$1 AND user_id=$2',[id,userId])).rows[0];}
app.get('/api/chats/:id/messages',async(req,res)=>{if(!await ownedChat(String(req.params.id),res.locals.user.id)){res.status(404).json({error:'Chat not found'});return;}res.json({messages:(await query('SELECT * FROM messages WHERE chat_id=$1 ORDER BY created_at,id',[req.params.id])).rows});});
app.post('/api/chats/:id/messages',async(req,res)=>{
 const chatId=String(req.params.id),user=res.locals.user,chat=await ownedChat(chatId,user.id);
 if(!chat){res.status(404).json({error:'Chat not found'});return;}
 const {message,requestId,fault}=req.body;
 if(typeof message!=='string'||!message.trim()||message.length>5000||typeof requestId!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(requestId)){res.status(400).json({error:'A message and valid request ID are required'});return;}
 if(fault&&(user.role!=='reviewer'||process.env.NODE_ENV==='production')){res.status(403).json({error:'Fault controls are available to local reviewers only'});return;}
 const client=await pool.connect();let replay:any=null,claimed=false,attemptId='';
 try{
  await client.query('BEGIN');await client.query('SELECT id FROM chats WHERE id=$1 FOR UPDATE',[chatId]);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[requestId]);
  const existing=(await client.query('SELECT * FROM requests WHERE id=$1',[requestId])).rows[0];
  if(existing&&existing.chat_id!==chatId){await client.query('ROLLBACK');res.status(409).json({error:'Request ID belongs to another chat'});return;}
  if(existing){const original=(await client.query("SELECT content FROM messages WHERE chat_id=$1 AND request_id=$2 AND role='user'",[chatId,requestId])).rows[0];if(original&&original.content!==message.trim()){await client.query('ROLLBACK');res.status(409).json({error:'A request ID must retain the original message'});return;}}
  if(existing?.status==='completed')replay=(await client.query("SELECT * FROM messages WHERE chat_id=$1 AND request_id=$2 AND role='assistant'",[chatId,requestId])).rows[0];
  else if(existing&&['running','pending'].includes(existing.status)){await client.query('COMMIT');res.status(409).json({error:'This message is already being processed',status:existing.status});return;}
  else{
   const busy=(await client.query("SELECT id FROM requests WHERE chat_id=$1 AND status IN ('running','pending')",[chatId])).rowCount;
   if(busy){await client.query('COMMIT');res.status(409).json({error:'Wait for the current reply before sending another message'});return;}
   const original=(await client.query("SELECT content FROM messages WHERE chat_id=$1 AND request_id=$2 AND role='user'",[chatId,requestId])).rows[0];
   if(original&&original.content!==message.trim()){await client.query('ROLLBACK');res.status(409).json({error:'A retry must use the original message'});return;}
   const attempt=(await client.query("INSERT INTO requests(id,chat_id,user_id,status,attempts) VALUES($1,$2,$3,'running',1) ON CONFLICT(id) DO UPDATE SET status='running',attempts=requests.attempts+1,error=NULL,updated_at=now() RETURNING attempts",[requestId,chatId,user.id])).rows[0];attemptId=requestId+'-'+attempt.attempts;
   await client.query("INSERT INTO messages(id,chat_id,request_id,role,content,status) VALUES($1,$2,$3,'user',$4,'running') ON CONFLICT(chat_id,request_id,role) DO UPDATE SET status='running'",[randomUUID(),chatId,requestId,message.trim()]);
   await client.query("UPDATE chats SET title=$2 WHERE id=$1 AND title='New conversation'",[chatId,message.trim().slice(0,45)]);claimed=true;
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 if(replay){res.json({message:replay,replayed:true});return;}if(!claimed){res.status(409).json({error:'Request cannot be processed'});return;}
 const traceId=randomUUID(),started=Date.now();let evidence:Passage[]=[];
 try{
  if(fault==='restart-delay')await new Promise(resolve=>setTimeout(resolve,10000));
  const lookupStarted=Date.now();const mappedFault=fault==='retrieval-error'?'retrieval_unavailable':fault==='missing-evidence'?'evidence_absent':fault;
  const history=(await query("SELECT role,content FROM messages WHERE chat_id=$1 AND request_id<>$2 AND status='completed' ORDER BY created_at",[chatId,requestId])).rows;
  const scope=resolveRetrievalScope(message.trim(),history as any);
  evidence=await retrieve(message.trim(),{fault:mappedFault,...scope,tracking:{userId:user.id,chatId,requestId,attemptId}});const retrievalMs=Date.now()-lookupStarted;
  const result=await generateAnswer({question:message.trim(),history:history as any,evidence,chatId,requestId,userId:user.id,threadId:chat.thread_id||undefined,fault,attemptId});
  const citations=evidence.filter(p=>result.citations.includes(p.id));const data={...result.trace,attemptId,model:result.model,usage:result.usage,costUsd:result.costUsd??null,skills:result.skills,retrievalMs,latencyMs:Date.now()-started,evidence,citations,status:'completed',fault:fault||null};
  const c=await pool.connect();let saved;try{await c.query('BEGIN');await c.query('INSERT INTO traces(id,chat_id,request_id,user_id,data) VALUES($1,$2,$3,$4,$5)',[traceId,chatId,requestId,user.id,JSON.stringify(data)]);
   saved=(await c.query("INSERT INTO messages(id,chat_id,request_id,role,content,status,citations,trace_id) VALUES($1,$2,$3,'assistant',$4,'completed',$5,$6) ON CONFLICT(chat_id,request_id,role) DO UPDATE SET content=excluded.content,status='completed',citations=excluded.citations,trace_id=excluded.trace_id RETURNING *",[randomUUID(),chatId,requestId,result.answer,JSON.stringify(citations),traceId])).rows[0];
   await c.query("UPDATE messages SET status='completed' WHERE chat_id=$1 AND request_id=$2 AND role='user'",[chatId,requestId]);await c.query("UPDATE requests SET status='completed',updated_at=now() WHERE id=$1",[requestId]);if(result.threadId)await c.query('UPDATE chats SET thread_id=$2 WHERE id=$1',[chatId,result.threadId]);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}res.json({message:saved});
 }catch(e){const error=e instanceof Error?e.message:String(e);await query("UPDATE requests SET status='failed',error=$2,updated_at=now() WHERE id=$1",[requestId,error]);await query("UPDATE messages SET status='failed' WHERE chat_id=$1 AND request_id=$2 AND role='user'",[chatId,requestId]);await query('INSERT INTO traces(id,chat_id,request_id,user_id,data) VALUES($1,$2,$3,$4,$5)',[traceId,chatId,requestId,user.id,JSON.stringify({status:'failed',attemptId,error,evidence,latencyMs:Date.now()-started,costUsd:null,fault:fault||null,injectionType:fault?'simulated':null})]);res.status(503).json({error:'Unable to answer right now. Your message is saved; retry it.',detail:error,requestId,traceId});}
});
app.get('/api/admin/traces',async(_req,res)=>{await collectCosts();res.json({traces:await getTraces()});});
app.get('/api/admin/evals',async(_req,res)=>{await collectCosts();res.json({runs:(await query('SELECT * FROM eval_runs ORDER BY created_at DESC')).rows});});
app.post('/api/admin/evals',async(_req,res)=>{if(evalRunning){res.status(409).json({error:'An evaluation is already running'});return;}evalRunning=true;res.status(202).json({status:'running'});import('./evals.js').then(m=>m.runEvals()).catch(e=>console.error('Evaluation failed:',e.message)).finally(()=>{evalRunning=false;});});
app.post('/api/admin/ingest',async(_req,res)=>{if(ingestionRunning){res.status(409).json({error:'Ingestion is already running'});return;}ingestionRunning=true;try{res.json({summary:await ingest()});}finally{ingestionRunning=false;}});
app.get('/api/admin/overview',async(_req,res)=>{await collectCosts();const costs=await getCostSummary();res.json({sources:await listSources(),evalRuns:(await query('SELECT * FROM eval_runs ORDER BY created_at DESC')).rows,traces:await getTraces(),stats:{...costs.totals,costByPurpose:costs.byPurpose,costBySession:costs.bySession,models:['gpt-6-luna','gpt-6-sol'],evalRunning},ingestion:await getIngestionStatus()});});
app.get('/api/admin/failures',async(_req,res)=>res.json({results:(await query('SELECT * FROM failure_results ORDER BY created_at DESC')).rows.map(r=>r.data)}));
app.get('/api/admin/sources/:id/raw',async(req,res)=>{const s=(await query('SELECT manifest FROM sources WHERE id=$1',[req.params.id])).rows[0];if(!s){res.status(404).json({error:'Source not found'});return;}const rawPath=path.resolve(s.manifest.raw_path);if(!rawPath.startsWith(path.resolve('data/raw')+path.sep)){res.status(403).json({error:'Invalid source path'});return;}res.type('text/plain').send(await readFile(rawPath,'utf8'));});
app.use(express.static(path.resolve('dist')));app.get('/{*path}',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
app.use((error:any,_req:any,res:any,_next:any)=>{console.error('Request error:',error.message);if(!res.headersSent)res.status(500).json({error:'Service error',detail:error.message});});
await boot();app.listen(port,process.env.APP_HOST||'127.0.0.1',()=>console.log(`Support portal ready at http://localhost:${port}`));
