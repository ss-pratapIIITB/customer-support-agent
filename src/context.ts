import {inferScope} from './rag.js';
import type {HistoryMessage} from './contracts.js';
export function resolveRetrievalScope(question:string,history:HistoryMessage[]):{product?:string;sourceType?:string;productIds?:string[]}{
 const explicit=inferScope(question);if(explicit.type||explicit.product)return {product:explicit.product,sourceType:explicit.type,...(explicit.productIds?{productIds:explicit.productIds}:{})};
 const previous=[...history].reverse().filter(m=>m.role==='user').map(m=>inferScope(m.content)).find(s=>s.type||s.product);
 if(!previous)return {};
 if(previous.type==='demo_policy'&&/\b(battery|charging|noise|water|dust|connector|controls|resistan|chip|display|camera|processor)\b/i.test(question))return {sourceType:'manufacturer'};
 return {product:previous.product,sourceType:previous.type,...(previous.productIds?{productIds:previous.productIds}:{})};
}
