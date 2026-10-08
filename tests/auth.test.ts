import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,sessionIdFromCookie} from '../src/auth.js';
test('seeded passwords verify without storing plaintext',()=>{const h=hashPassword('Demo123!');assert.notEqual(h,'Demo123!');assert.equal(verifyPassword('Demo123!',h),true);assert.equal(verifyPassword('wrong',h),false);});
test('session parsing does not confuse unrelated cookies',()=>{assert.equal(sessionIdFromCookie('other=bad; support_session=abc; x=1'),'abc');assert.equal(sessionIdFromCookie('other=abc'),null);});
