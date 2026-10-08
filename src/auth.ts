import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
export function hashPassword(value:string){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(value,salt,64).toString('hex');}
export function verifyPassword(value:string,hash:string){const [salt,digest]=hash.split(':');if(!salt||!digest)return false;const expected=Buffer.from(digest,'hex');const actual=scryptSync(value,salt,64);return expected.length===actual.length&&timingSafeEqual(expected,actual);}
export function sessionIdFromCookie(value?:string){const pair=value?.split(';').map(v=>v.trim()).find(v=>v.startsWith('support_session='));return pair?.slice('support_session='.length)||null;}
