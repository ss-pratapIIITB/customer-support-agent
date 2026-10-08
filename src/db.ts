import 'dotenv/config';
import pg from 'pg';
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL || process.env.APP_DATABASE_URL || 'postgres://support:support@localhost:5432/support',max:10});
export function query<T extends pg.QueryResultRow = any>(sql:string,values?:any[]):Promise<pg.QueryResult<T>> {return pool.query<T>(sql,values);}
export async function initializeDatabase():Promise<void> {
 await query(`CREATE EXTENSION IF NOT EXISTS vector;
 CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,role text NOT NULL);
 CREATE TABLE IF NOT EXISTS auth_sessions(id text PRIMARY KEY,user_id text REFERENCES users(id),expires_at timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS chats(id text PRIMARY KEY,user_id text REFERENCES users(id),title text NOT NULL,thread_id text,created_at timestamptz DEFAULT now());
 CREATE INDEX IF NOT EXISTS chats_owner ON chats(user_id,created_at);
 CREATE TABLE IF NOT EXISTS messages(id text PRIMARY KEY,chat_id text REFERENCES chats(id),request_id text,role text NOT NULL,content text NOT NULL,status text,citations jsonb DEFAULT '[]',trace_id text,created_at timestamptz DEFAULT now(),UNIQUE(chat_id,request_id,role));
 CREATE TABLE IF NOT EXISTS requests(id text PRIMARY KEY,chat_id text REFERENCES chats(id),user_id text REFERENCES users(id),status text NOT NULL,error text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(chat_id,id));
 CREATE TABLE IF NOT EXISTS traces(id text PRIMARY KEY,chat_id text,request_id text,user_id text,data jsonb NOT NULL,created_at timestamptz DEFAULT now());
 CREATE TABLE IF NOT EXISTS eval_runs(id text PRIMARY KEY,created_at timestamptz DEFAULT now(),status text,results jsonb);
 CREATE TABLE IF NOT EXISTS corpus_versions(id text PRIMARY KEY,status text NOT NULL,created_at timestamptz DEFAULT now(),activated_at timestamptz,error text);
 CREATE UNIQUE INDEX IF NOT EXISTS corpus_one_active ON corpus_versions(status) WHERE status='active';
 CREATE TABLE IF NOT EXISTS sources(id text PRIMARY KEY,title text NOT NULL,url text NOT NULL,source_type text NOT NULL,product_id text,version text NOT NULL,manifest jsonb NOT NULL);
 CREATE TABLE IF NOT EXISTS chunks(id text NOT NULL,corpus_version text REFERENCES corpus_versions(id),source_id text REFERENCES sources(id),content text NOT NULL,embedding vector(1536) NOT NULL,search tsvector GENERATED ALWAYS AS (to_tsvector('english',content)) STORED,PRIMARY KEY(corpus_version,id));
 CREATE INDEX IF NOT EXISTS chunks_search ON chunks USING gin(search);
 CREATE INDEX IF NOT EXISTS chunks_source_version ON chunks(corpus_version,source_id);
 CREATE INDEX IF NOT EXISTS sources_product ON sources(product_id,version);
 CREATE INDEX IF NOT EXISTS chunks_embedding ON chunks USING hnsw(embedding vector_cosine_ops);
 CREATE TABLE IF NOT EXISTS embedding_cache(hash text PRIMARY KEY,model text NOT NULL,embedding vector(1536) NOT NULL);
 `);
}
