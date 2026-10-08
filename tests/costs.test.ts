import {test} from 'node:test';import assert from 'node:assert/strict';
import {trackingFromTags} from '../src/costs.js';
test('query embedding tags correlate to the same request attempt and evaluation',()=>{assert.deepEqual(trackingFromTags(['purpose:query-embedding','requestId:r1','attemptId:r1-2','chatId:c1','evalRunId:e1']),{purpose:'query-embedding',requestId:'r1',attemptId:'r1-2',chatId:'c1',evalRunId:'e1'});});
