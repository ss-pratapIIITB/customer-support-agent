import { createHash } from 'node:crypto';
import { config } from './config.js';
import { query } from './db.js';
import { logger } from './logger.js';
import { withSpan, spanAttributes } from './telemetry.js';

const DIMENSIONS = 1536;
export const embeddingEnabled = config.embeddings;
let embeddingProviderDown = false;

export function contentHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

async function requestEmbeddings(input: string[], purpose: string): Promise<number[][]> {
  if (!embeddingEnabled) throw new Error('Embeddings are disabled');
  if (embeddingProviderDown) throw new Error('Embedding provider unavailable');
  const base = config.OPENAI_BASE_URL.replace(/\/$/, '');
  return withSpan(
    'embeddings.request',
    spanAttributes({
      'gen_ai.system': 'openai',
      'gen_ai.request.model': config.EMBEDDING_MODEL,
      'gen_ai.request.batch_size': input.length,
      'support.purpose': purpose,
    }),
    async (span) => {
      const response = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: config.EMBEDDING_MODEL, input }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        // Never persist provider response bodies: they can echo request headers.
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Embedding provider HTTP ${response.status}`);
      }
      const body = (await response.json()) as {
        data: Array<{ index: number; embedding: number[] }>;
        usage?: { prompt_tokens?: number };
      };
      span.setAttribute('gen_ai.usage.input_tokens', body.usage?.prompt_tokens ?? 0);
      const vectors = body.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
      if (
        vectors.length !== input.length ||
        vectors.some((vector) => !Array.isArray(vector) || vector.length !== DIMENSIONS)
      ) {
        throw new Error('Embedding dimension or batch mismatch');
      }
      return vectors;
    },
  );
}

export async function cachedEmbeddings(
  texts: string[],
  purpose: string,
): Promise<{ vectors: number[][]; calls: number }> {
  if (!embeddingEnabled || embeddingProviderDown) {
    return { vectors: texts.map(() => []), calls: 0 };
  }
  const hashes = texts.map((text) =>
    contentHash(`${config.EMBEDDING_MODEL}:${DIMENSIONS}:${text}`),
  );
  const existing = await query<{ hash: string; embedding: string }>(
    `SELECT hash, embedding::text AS embedding FROM embedding_cache WHERE hash = ANY($1)`,
    [hashes],
  );
  const cache = new Map(
    existing.rows.map((row) => [row.hash, JSON.parse(row.embedding) as number[]]),
  );
  const missing = [...new Map(texts.map((text, index) => [hashes[index], text])).entries()].filter(
    ([hash]) => !cache.has(hash),
  );

  let calls = 0;
  for (let index = 0; index < missing.length; index += 64) {
    const batch = missing.slice(index, index + 64);
    let vectors: number[][];
    try {
      vectors = await requestEmbeddings(
        batch.map(([, text]) => text),
        purpose,
      );
    } catch (error) {
      embeddingProviderDown = true;
      logger.warn(
        { err: error },
        'Embedding provider unavailable; continuing with lexical retrieval',
      );
      break;
    }
    calls += 1;
    for (let offset = 0; offset < batch.length; offset += 1) {
      const [hash] = batch[offset];
      await query(
        `INSERT INTO embedding_cache(hash, model, embedding) VALUES($1,$2,$3::vector)
         ON CONFLICT (hash) DO NOTHING`,
        [hash, config.EMBEDDING_MODEL, vectorLiteral(vectors[offset])],
      );
      cache.set(hash, vectors[offset]);
    }
  }
  const missingHashes = hashes.filter((hash) => !cache.has(hash));
  if (missingHashes.length) {
    logger.warn({ count: missingHashes.length }, 'Some embeddings missing after cache fill');
  }
  return { vectors: hashes.map((hash) => cache.get(hash) ?? []), calls };
}

export async function embedQuery(question: string): Promise<number[] | null> {
  if (!embeddingEnabled || embeddingProviderDown) return null;
  try {
    const { vectors } = await cachedEmbeddings([question], 'query-embedding');
    return vectors[0]?.length ? vectors[0] : null;
  } catch (error) {
    logger.warn({ err: error }, 'Query embedding failed; falling back to lexical retrieval');
    return null;
  }
}
