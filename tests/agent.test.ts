import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateAnswer, missingEvidenceAnswer, generateAnswer } from '../src/agent.js';
describe('grounded answer boundaries', () => {
 it('records an injected timeout as failure instead of returning an answer', async () => {
  await assert.rejects(generateAnswer({question:'Battery?',history:[],evidence:[],userId:'test',chatId:'test',requestId:'timeout',fault:'model-timeout'}), /MODEL_TIMEOUT/);
 });
 it('returns unsupported evidence without invoking a provider', async () => {
  const result=await generateAnswer({question:'What is my order number?',history:[],evidence:[],userId:'test',chatId:'test',requestId:'unknown'});
  assert.equal(result.trace?.modelCalled,false);assert.deepEqual(result.citations,[]);
 });
 it('abstains with no evidence without making product claims', () => {
  assert.deepEqual(missingEvidenceAnswer().citations, []);
  assert.match(missingEvidenceAnswer().answer, /evidence/);
 });
 it('rejects invented citation identifiers', () => {
  assert.throws(() => validateAnswer({answer:'Supported fact',citations:['invented']}, [{id:'real',content:'Fact',title:'Source',url:'x',source_type:'product'}]), /citation/);
 });
 it('rejects uncited factual answers', () => {
  assert.throws(() => validateAnswer({answer:'Battery is 50 hours',citations:[],behavior:'answer'}, [{id:'real',content:'Fact',title:'Source',url:'x',source_type:'product'}]), /citation/);
 });
});
