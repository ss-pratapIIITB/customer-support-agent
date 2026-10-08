export type Passage = { id:string; content:string; title:string; url:string; source_type:string; product_id?:string; score?:number; [key:string]:unknown };
export type HistoryMessage = {role:'user'|'assistant';content:string};
export type AgentInput = { question:string; history:HistoryMessage[]; evidence:Passage[]; chatId:string; requestId:string; userId:string; threadId?:string; fault?:string; attemptId?:string };
export type AgentResult = {answer:string; citations:string[]; model:string; threadId?:string; usage?:Record<string,unknown>; costUsd?:number|null; trace?:Record<string,unknown>; skills?:string[]};
