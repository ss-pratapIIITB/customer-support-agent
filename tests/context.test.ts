import {test} from 'node:test';import assert from 'node:assert/strict';
import {resolveRetrievalScope} from '../src/context.js';
test('latest comparison retains both named products instead of an older single product',()=>{assert.deepEqual(resolveRetrievalScope('How do I charge them?',[{role:'user',content:'AirPods Pro 3'},{role:'user',content:'Compare AirPods Pro 3 and AirPods Max 2'}]),{product:undefined,sourceType:'manufacturer',productIds:['airpods-pro-3','airpods-max-2']});});
test('policy follow-up retains latest policy rather than older product',()=>{assert.deepEqual(resolveRetrievalScope('Is that free?',[{role:'user',content:'AirPods Pro 3'},{role:'user',content:'What is shipping?'}]),{product:undefined,sourceType:'demo_policy'});});
test('explicit current product overrides conversation history',()=>{assert.deepEqual(resolveRetrievalScope('AirPods Max 2 battery?',[{role:'user',content:'AirPods Pro 3'}]),{product:'airpods-max-2',sourceType:'manufacturer'});});
