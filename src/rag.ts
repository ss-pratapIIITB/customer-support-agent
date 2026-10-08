import 'dotenv/config';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { query,pool,initializeDatabase } from './db.js';
import type { Passage } from './contracts.js';
const model='text-embedding-3-small';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const vector=(v:number[])=>'['+v.join(',')+']';
type Source={id:string;title:string;url:string;source_type:string;product_id?:string;version:string;raw_path:string;[key:string]:unknown};
export function extractSections(html:string):string[] {
 const $=load(html);const footnotes=$('[id^=footnote-]').map((_,el)=>'Source footnote '+$(el).attr('id')+': '+$(el).text()).get().join('\n');$('script,style,nav,header,footer,noscript').remove();
 const root=$('main').length?$('main'):$('body');
 const text=(root.text()+'\n'+footnotes).replace(/[\t ]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
 // Keep continuous source order and overlapping context, including variant headings and footnotes.
 const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);const chunks:string[]=[];let current='';
 for(const line of lines){if(current.length+line.length>2200&&current){chunks.push(current);current=current.slice(-350)+'\n';}current+=line+'\n';}if(current.trim())chunks.push(current.trim());return chunks;
}
export function inferScope(question:string):{type?:string;product?:string;productIds?:string[]} {
 if(/\b(returns?|refunds?|shipping|delivery|warranty|store polic(?:y|ies))\b/i.test(question))return {type:'demo_policy'};
 const normalize=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const q=' '+normalize(question)+' ';
 const sources:Source[]=JSON.parse(readFileSync('data/manifest.json','utf8'));
 const matches=sources.filter(s=>s.source_type==='manufacturer').flatMap(s=>{
  const title=normalize(s.title);const aliases=[title];
  if(s.product_id==='airpods-pro-3')aliases.push('airpods pro');
  if(s.product_id==='airpods-max-2')aliases.push('airpods max');
  const match=aliases.filter(name=>q.includes(' '+name+' ')).sort((a,b)=>b.length-a.length)[0];
  return match?[{product:s.product_id!,name:match}]:[];
 });
 const specific=matches.filter(m=>!matches.some(other=>other.product!==m.product&&other.name.startsWith(m.name+' ')));
 if(specific.length===1)return {type:'manufacturer',product:specific[0].product};
 if(specific.length>1)return {type:'manufacturer',productIds:specific.map(s=>s.product)};
 return {};
}
export type EmbeddingTracking={userId?:string;chatId?:string;requestId?:string;attemptId?:string;evalRunId?:string;caseId?:string};
async function embeddings(input:string[],tracking:EmbeddingTracking={},purpose='query-embedding'):Promise<number[][]> {
 const base=(process.env.LITELLM_BASE_URL||'http://localhost:4000/v1').replace(/\/$/,'').replace(/\/v1$/,'');
 const tags=['purpose:'+purpose,'application:support-demo',...Object.entries(tracking).filter(([,v])=>v).map(([k,v])=>k+':'+v)];
 const response=await fetch(base+'/v1/embeddings',{method:'POST',headers:{'Content-Type':'application/json','x-litellm-tags':tags.join(','),Authorization:'Bearer '+(process.env.LITELLM_API_KEY||'demo-local-key')},body:JSON.stringify({model,input,metadata:{tags,...tracking}}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error('Embedding gateway unavailable: HTTP '+response.status);
 const result:any=await response.json();const vectors=result.data.sort((a:any,b:any)=>a.index-b.index).map((d:any)=>d.embedding);
 if(vectors.length!==input.length||vectors.some((v:any)=>!Array.isArray(v)||v.length!==1536))throw new Error('Embedding dimension or batch mismatch');return vectors;
}
async function cachedEmbeddings(texts:string[],tracking:EmbeddingTracking={},purpose='query-embedding'):Promise<number[][]>{
 const ids=texts.map(t=>hash(model+':1536:'+t));const existing=await query('SELECT hash,embedding::text AS embedding FROM embedding_cache WHERE hash=ANY($1)',[ids]);
 const cache=new Map<string,number[]>(existing.rows.map(r=>[r.hash,JSON.parse(r.embedding)]));
 const missing=[...new Map(texts.map((t,i)=>[ids[i],t])).entries()].filter(([id])=>!cache.has(id));
 for(let i=0;i<missing.length;i+=32){const batch=missing.slice(i,i+32);const vs=await embeddings(batch.map(x=>x[1]),tracking,purpose);for(let j=0;j<batch.length;j++){await query('INSERT INTO embedding_cache(hash,model,embedding) VALUES($1,$2,$3::vector) ON CONFLICT DO NOTHING',[batch[j][0],model,vector(vs[j])]);cache.set(batch[j][0],vs[j]);}}
 return ids.map(id=>cache.get(id)!);
}
export async function ingest(options:{fault?:string}={}):Promise<any>{
 await initializeDatabase();const sources:Source[]=JSON.parse(await readFile('data/manifest.json','utf8'));
 if(sources.length<6)throw new Error('Expected at least six preserved source documents');
 const version=hash(JSON.stringify(sources.map(s=>[s.id,s.version]))+model)+(options.fault?'-fault-staging':'');const active=await query("SELECT id FROM corpus_versions WHERE status='active'");
 if(active.rows[0]?.id===version&&!options.fault)return {version,status:'active',unchanged:true,sources:sources.length,embeddingCalls:0};
 await query("INSERT INTO corpus_versions(id,status) VALUES($1,'staging') ON CONFLICT(id) DO UPDATE SET status=CASE WHEN corpus_versions.status='active' THEN 'active' ELSE 'staging' END,error=NULL",[version]);
 try{
 let total=0;
 for(const source of sources){
  const sourceKey=source.id+'@'+source.version;
  const raw=await readFile(source.raw_path,'utf8');const sections=source.source_type==='manufacturer'?extractSections(raw):[raw];
  if(!sections.length)throw new Error('No text extracted for '+source.id);
  await mkdir('data/processed',{recursive:true});await writeFile('data/processed/'+source.id+'.txt',sections.join('\n\n---\n\n'));
  await query('INSERT INTO sources(id,title,url,source_type,product_id,version,manifest) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET title=excluded.title,url=excluded.url,version=excluded.version,manifest=excluded.manifest',[sourceKey,source.title,source.url,source.source_type,source.product_id||null,source.version,JSON.stringify(source)]);
  const texts=sections.map(t=>source.title+'\n'+t);const vectors=await cachedEmbeddings(texts,{},'ingestion-embedding');
  for(let i=0;i<texts.length;i++){const id=source.id+'-'+hash(texts[i]).slice(0,16);await query('INSERT INTO chunks(id,corpus_version,source_id,content,embedding) VALUES($1,$2,$3,$4,$5::vector) ON CONFLICT DO NOTHING',[id,version,sourceKey,texts[i],vector(vectors[i])]);total++;}
  if(options.fault==='ingestion_interrupt'||options.fault==='ingestion-interruption')throw new Error('Simulated ingestion interruption after partial staging writes');
 }
 const client=await pool.connect();try{await client.query('BEGIN');await client.query("UPDATE corpus_versions SET status='retired' WHERE status='active' AND id<>$1",[version]);await client.query("UPDATE corpus_versions SET status='active',activated_at=now(),error=NULL WHERE id=$1",[version]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 return {version,status:'active',sources:sources.length,chunks:total};
 }catch(e){await query('UPDATE corpus_versions SET error=$2 WHERE id=$1',[version,String(e)]);throw e;}
}
export async function getIngestionStatus(){const r=await query('SELECT id,status,created_at,activated_at,error FROM corpus_versions ORDER BY created_at DESC');return {ready:r.rows.some(x=>x.status==='active'),versions:r.rows};}
export async function listSources():Promise<any[]>{return (await query('SELECT s.*,count(c.id)::int AS chunks FROM sources s LEFT JOIN chunks c ON c.source_id=s.id AND c.corpus_version IN (SELECT id FROM corpus_versions WHERE status=\'active\') WHERE c.id IS NOT NULL GROUP BY s.id ORDER BY s.title')).rows;}
export async function retrieve(question:string,options:{fault?:string;product?:string;productIds?:string[];sourceType?:string;tracking?:EmbeddingTracking}={}):Promise<Passage[]>{
 if(['retrieval_unavailable','retrieval-unavailable','retrieval'].includes(options.fault||''))throw new Error('Simulated retrieval adapter unavailable');
 if(['evidence_absent','evidence-absent','empty'].includes(options.fault||''))return [];
 if(/\b(stock price|inventory|in stock|my order|order status|medical|diagnos|live price)\b/i.test(question))return [];
 const ready=await query("SELECT id FROM corpus_versions WHERE status='active'");if(!ready.rowCount)throw new Error('Evidence corpus is not ready. Run ingestion.');
 const inferred=inferScope(question);const scope={type:inferred.type||options.sourceType,product:inferred.product||(inferred.type?undefined:options.product)};const [embedding]=await cachedEmbeddings([question],options.tracking);
 const rows=await query(`WITH eligible AS (
 SELECT c.*,s.title,s.url,s.source_type,s.product_id FROM chunks c JOIN sources s ON s.id=c.source_id
 WHERE c.corpus_version=$1 AND ($3::text IS NULL OR s.source_type=$3) AND ($4::text IS NULL OR s.product_id=$4) AND ($7::text[] IS NULL OR s.product_id=ANY($7))
 ), semantic AS (SELECT id,row_number() OVER(ORDER BY embedding <=> $2::vector) AS rank,embedding <=> $2::vector AS distance FROM eligible ORDER BY embedding <=> $2::vector LIMIT 24),
 lexical AS (SELECT id,row_number() OVER(ORDER BY ts_rank_cd(search,websearch_to_tsquery('english',$5)) DESC) AS rank FROM eligible WHERE search @@ websearch_to_tsquery('english',$5) ORDER BY ts_rank_cd(search,websearch_to_tsquery('english',$5)) DESC LIMIT 24)
 SELECT e.id,e.content,e.title,e.url,e.source_type,e.product_id,e.corpus_version,(COALESCE(1.0/(60+s.rank),0)+COALESCE(1.0/(60+l.rank),0))::float AS score,s.distance FROM eligible e LEFT JOIN semantic s USING(id) LEFT JOIN lexical l USING(id) WHERE (s.id IS NOT NULL OR l.id IS NOT NULL) AND (l.id IS NOT NULL OR s.distance<0.72) ORDER BY CASE WHEN $6::boolean AND e.content ~* 'up to[[:space:]]+[0-9]+[[:space:]]+hours' THEN 1 ELSE 0 END DESC,score DESC LIMIT 8`,[ready.rows[0].id,vector(embedding),scope.type||null,scope.product||null,question,Boolean(scope.product&&!scope.product.startsWith('airpods-')&&/battery|how long.*last/i.test(question)),inferred.productIds||options.productIds||null]);
 return rows.rows;
}
