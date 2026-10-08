import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
test('completed request cannot replay a different customer message',{skip:process.env.HTTP_INTEGRATION!=='1'},async()=>{
 const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3000';
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'reviewer@maxify.demo',password:'Demo123!'})});const l:any=await login.json();const cookie=login.headers.get('set-cookie')!.split(';')[0];const requestId=randomUUID();
 const send=(message:string)=>fetch(base+`/api/chats/${l.chatId}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({message,requestId})});
 const first=await send('What is my order status?');assert.equal(first.status,200);const changed=await send('What is my order tracking number?');assert.equal(changed.status,409);
});
