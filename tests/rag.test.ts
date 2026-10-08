import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extractSections,inferScope,retrieve } from '../src/rag.js';
test('HTML extraction preserves product variants and qualifying footnotes without scripts',()=>{
 const text=extractSections('<main><h2>AirPods 5</h2><p>Up to 8 hours with noise control off.</p><h3>With ANC enabled</h3><p>Up to 6 hours.</p><p>Battery varies by use.</p></main><script>ignore me</script>').join(' ');
 assert.match(text,/8 hours with noise control off/);assert.match(text,/ANC enabled/);assert.match(text,/Battery varies/);assert.doesNotMatch(text,/ignore me/);
});
test('policy questions scope to fictional retailer, named product questions to manufacturer',()=>{
 assert.deepEqual(inferScope('Can I return AirPods Pro?'),{type:'demo_policy'});
 assert.deepEqual(inferScope('Tell me about AirPods Max 2. What about the returns policy for those?'),{type:'demo_policy'});
 assert.deepEqual(inferScope('AirPods Max battery life'),{type:'manufacturer',product:'airpods-max-2'});
 assert.deepEqual(inferScope('AirPods Pro noise cancellation'),{type:'manufacturer',product:'airpods-pro-3'});
 assert.deepEqual(inferScope('Compare AirPods Pro and AirPods Max'),{type:'manufacturer',productIds:['airpods-pro-3','airpods-max-2']});
 assert.deepEqual(inferScope('MacBook Pro camera'),{type:'manufacturer',product:'macbook-pro'});
 assert.deepEqual(inferScope('iPad Air battery life'),{type:'manufacturer',product:'ipad-air'});
});
test('preserved corpus has at least six hashed snapshots and explicit fictional policies',async()=>{
 const manifest=JSON.parse(await readFile('data/manifest.json','utf8'));assert.ok(manifest.length>=6);
 for(const source of manifest){const raw=await readFile(source.raw_path,'utf8');assert.ok(raw.length>100);assert.equal(createHash('sha256').update(raw).digest('hex'),source.content_hash);if(source.source_type==='demo_policy')assert.match(raw,/Demo store policy/i);else assert.ok(raw.includes(source.title),source.title);}
});
test('retrieval faults do not silently return evidence and absent evidence stays empty',async()=>{
 await assert.rejects(retrieve('battery',{fault:'retrieval_unavailable'}),/unavailable/);
 assert.deepEqual(await retrieve('battery',{fault:'evidence_absent'}),[]);
 assert.deepEqual(await retrieve('What is my order status?'),[]);
});
test('live ingestion keeps active corpus during interruption and unchanged rerun avoids embeddings',{skip:process.env.RAG_INTEGRATION!=='1'},async()=>{
 const {ingest,getIngestionStatus}=await import('../src/rag.js');const {query,pool}=await import('../src/db.js');
 try{
 const first=await ingest();const count=(await query('SELECT count(*)::int AS n FROM chunks WHERE corpus_version=$1',[first.version])).rows[0].n;
 await assert.rejects(ingest({fault:'ingestion_interrupt'}),/interruption/);
 const active=(await getIngestionStatus()).versions.find(x=>x.status==='active');assert.equal(active.id,first.version);
 const rerun=await ingest();assert.equal(rerun.unchanged,true);assert.equal(rerun.embeddingCalls,0);
 assert.equal((await query('SELECT count(*)::int AS n FROM chunks WHERE corpus_version=$1',[first.version])).rows[0].n,count);
 const evidence=await retrieve('How long does AirPods Pro battery last?');assert.ok(evidence.length>0);assert.ok(evidence.every(x=>x.product_id==='airpods-pro-3'));
 const manifest=JSON.parse(await readFile('data/manifest.json','utf8'));
 for(const product of manifest.filter((s:any)=>s.source_type==='manufacturer')){const evidence=await retrieve(product.title+' battery life');assert.ok(evidence.length>0,product.title);assert.ok(evidence.every(p=>p.product_id===product.product_id),product.title);if(!product.product_id.startsWith('airpods-'))assert.match(evidence.map(p=>p.content).join('\n'),/up to \d+ hours/i,product.title);}
 }finally{await pool.end();}
});
