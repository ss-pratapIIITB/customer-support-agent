import type { Citation, Passage, RetrievalScope } from './contracts.js';
import { query } from './db.js';
import { embedQuery } from './embeddings.js';
import { logger } from './logger.js';
import { instruments, spanAttributes, withSpan } from './telemetry.js';

const STOPWORDS = new Set(
  `a an the and or but if then than that this these those is are was were be been being do does did
   have has had i me my we our you your it its of to in on at for with from by about as into over
   under again more most some such no nor not only own same so too very can could should would will
   just what which who whom when where why how long much many please tell give show need want`
    .split(/\s+/)
    .filter(Boolean),
);

export function keywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .map((token) => (['weigh', 'weighs', 'heavy'].includes(token) ? 'weight' : token))
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
    ),
  ].slice(0, 14);
}

function tsQuery(tokens: string[]): string {
  const terms = tokens
    .map((token) => token.replace(/-/g, ''))
    .filter((token) => /^[a-z0-9]+$/.test(token));
  return terms.length ? terms.map((token) => `${token}:*`).join(' | ') : 'support';
}

function scopeValues(scope: RetrievalScope): {
  sourceType: string | null;
  productIds: string[] | null;
} {
  const productIds = scope.productIds?.length
    ? scope.productIds
    : scope.product
      ? [scope.product]
      : null;
  return { sourceType: scope.sourceType ?? null, productIds };
}

const TERM_EXPANSIONS: Record<string, string[]> = {
  battery: ['listening', 'playback', 'hours', 'charge'],
  display: ['screen', 'retina', 'oled', 'resolution', 'inch'],
  chip: ['processor', 'cpu', 'gpu', 'core'],
  weight: ['pound', 'pounds', 'gram', 'grams', 'kg'],
  camera: ['photo', 'video', 'lens', 'zoom'],
  storage: ['gb', 'tb', 'ssd'],
  memory: ['gb', 'ram', 'unified'],
  audio: ['sound', 'speaker', 'driver'],
  connectivity: ['bluetooth', 'wifi', 'wireless', '5g'],
  charging: ['usb', 'magsafe', 'adapter', 'cable', 'port'],
  noise: ['anc', 'cancellation', 'transparency'],
  water: ['resistant', 'dust', 'ip'],
};

const UNSUPPORTED =
  /\b(stock price|live price|inventory|in stock|order status|tracking number|my order|medical|diagnos|prescription)\b/i;

export async function retrieve(
  question: string,
  options: { scope?: RetrievalScope; fault?: string; topK?: number } = {},
): Promise<Passage[]> {
  if (
    ['retrieval_unavailable', 'retrieval-unavailable', 'retrieval-error'].includes(
      options.fault ?? '',
    )
  ) {
    throw new Error('Retrieval adapter unavailable');
  }
  if (['evidence_absent', 'evidence-absent', 'empty'].includes(options.fault ?? '')) return [];
  if (UNSUPPORTED.test(question) && options.scope?.sourceType !== 'demo_policy') return [];

  return withSpan(
    'retrieval.hybrid_search',
    spanAttributes({
      'support.question': question.slice(0, 500),
      'support.scope.product': options.scope?.product ?? undefined,
      'support.scope.products': options.scope?.productIds?.join(',') ?? undefined,
      'support.scope.source_type': options.scope?.sourceType ?? undefined,
    }),
    async (span) => {
      const active = await query<{ id: string }>(
        `SELECT id FROM corpus_versions WHERE status='active'`,
      );
      const version = active.rows[0]?.id;
      if (!version) throw new Error('Evidence corpus is not ready. Run ingestion.');

      const scope = scopeValues(options.scope ?? {});
      const topK = options.topK ?? 8;
      // Product names are already enforced by the scope filter. Leaving them in
      // the lexical query lets "MacBook"/"Air"/"Pro" drown out the actual fact
      // ("battery", "chip", ...), especially for comparisons.
      const scopeTokens = new Set(
        (scope.productIds ?? []).flatMap((id) => id.toLowerCase().split(/[^a-z0-9]+/)),
      );
      const scopedKeywords = keywords(question).filter((token) => !scopeTokens.has(token));
      const baseTerms = scopedKeywords.length ? scopedKeywords : keywords(question);
      const lexicalTerms = [
        ...new Set(baseTerms.flatMap((token) => [token, ...(TERM_EXPANSIONS[token] ?? [])])),
      ];
      const lexicalQuery = tsQuery(lexicalTerms);
      const fuzzyTerm = [...baseTerms].sort((a, b) => b.length - a.length)[0] ?? '';
      const embedding = await embedQuery(question);
      const started = performance.now();

      let rows;
      if (embedding) {
        const result = await query<Passage>(
          `WITH eligible AS (
             SELECT c.*, s.title, s.url, s.source_type, s.product_id
               FROM chunks c JOIN sources s ON s.id=c.source_id
              WHERE c.corpus_version=$1
                AND ($2::text IS NULL OR s.source_type=$2)
                AND ($3::text[] IS NULL OR s.product_id = ANY($3))
           ),
           lexical AS (
             SELECT id, ts_rank_cd(search, to_tsquery('english',$4)) AS lexical_score
               FROM eligible WHERE search @@ to_tsquery('english',$4)
           ),
           semantic AS (
             SELECT id, row_number() OVER (ORDER BY embedding <=> $5::vector) AS rank
               FROM eligible WHERE embedding IS NOT NULL
              ORDER BY embedding <=> $5::vector LIMIT 40
           ),
           fuzzy AS (
             SELECT id, similarity(content,$6) AS sim
               FROM eligible WHERE $6 <> '' AND content ILIKE '%' || $6 || '%'
              ORDER BY sim DESC LIMIT 20
           )
           SELECT e.id,e.content,e.title,e.url,e.source_type,e.product_id,e.section,
                  (COALESCE(1.0/(60+s.rank),0) + COALESCE(l.lexical_score,0)*0.9
                   + COALESCE(f.sim,0)*0.25
                   + CASE WHEN $6 <> '' AND e.section ILIKE '%' || $6 || '%' THEN 0.2 ELSE 0 END)::float AS score
             FROM eligible e
             LEFT JOIN lexical l USING(id)
             LEFT JOIN semantic s USING(id)
             LEFT JOIN fuzzy f USING(id)
            WHERE l.id IS NOT NULL OR s.id IS NOT NULL OR f.id IS NOT NULL
            ORDER BY score DESC LIMIT $7`,
          [
            version,
            scope.sourceType,
            scope.productIds,
            lexicalQuery,
            `[${embedding.join(',')}]`,
            fuzzyTerm,
            topK,
          ],
        );
        rows = result.rows;
      } else {
        const result = await query<Passage>(
          `WITH eligible AS (
             SELECT c.*, s.title, s.url, s.source_type, s.product_id
               FROM chunks c JOIN sources s ON s.id=c.source_id
              WHERE c.corpus_version=$1
                AND ($2::text IS NULL OR s.source_type=$2)
                AND ($3::text[] IS NULL OR s.product_id = ANY($3))
           ),
           lexical AS (
             SELECT id, ts_rank_cd(search, to_tsquery('english',$4)) AS lexical_score
               FROM eligible WHERE search @@ to_tsquery('english',$4)
           ),
           fuzzy AS (
             SELECT id, similarity(content,$5) AS sim
               FROM eligible WHERE $5 <> '' AND content ILIKE '%' || $5 || '%'
              ORDER BY sim DESC LIMIT 24
           )
           SELECT e.id,e.content,e.title,e.url,e.source_type,e.product_id,e.section,
                  (COALESCE(1.0/(60+row_number() OVER (ORDER BY l.lexical_score DESC)),0)
                   + COALESCE(l.lexical_score,0)*0.9
                   + COALESCE(f.sim,0)*0.25
                   + CASE WHEN $5 <> '' AND e.section ILIKE '%' || $5 || '%' THEN 0.2 ELSE 0 END)::float AS score
             FROM eligible e
             LEFT JOIN lexical l USING(id)
             LEFT JOIN fuzzy f USING(id)
            WHERE l.id IS NOT NULL OR f.id IS NOT NULL
            ORDER BY score DESC LIMIT $6`,
          [version, scope.sourceType, scope.productIds, lexicalQuery, fuzzyTerm, topK],
        );
        rows = result.rows;
      }

      const duration = Math.max(0, Math.round(performance.now() - started));
      span.setAttribute('support.retrieval.result_count', rows.length);
      span.setAttribute('support.retrieval.mode', embedding ? 'hybrid' : 'lexical');
      span.setAttribute('support.retrieval.duration_ms', duration);
      instruments.retrieval.record(duration, {
        mode: embedding ? 'hybrid' : 'lexical',
        scope: options.scope?.sourceType ?? 'all',
      });
      logger.debug(
        { count: rows.length, scope, mode: embedding ? 'hybrid' : 'lexical', duration },
        'Retrieval complete',
      );
      return rows;
    },
  );
}

function excerpt(content: string, max = 260): string {
  const lines = content
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 14)
    .filter((line) => !/^(see .* in ar|learn more|shop now|buy now)$/i.test(line));
  if (!lines.length) return content.replace(/\s+/g, ' ').trim().slice(0, max);

  const score = (line: string): number => {
    let value = 0;
    if (
      /(\d+(\.\d+)?\s*(hours?|hrs?|minutes?|days?|months?|mm|inches?|grams?|db|mah|w|gb|tb|mp|hz))/i.test(
        line,
      )
    ) {
      value += 5;
    }
    if (/up to|within|eligible|return|refund|warranty|shipping|included/i.test(line)) value += 2;
    if (/\d/.test(line)) value += 1;
    if (line.length >= 40 && line.length <= 320) value += 1;
    return value;
  };

  let bestIndex = 0;
  let bestScore = -1;
  lines.forEach((line, index) => {
    const value = score(line);
    if (value > bestScore) {
      bestScore = value;
      bestIndex = index;
    }
  });

  let snippet = lines[bestIndex];
  const next = lines[bestIndex + 1];
  if (snippet.length < 70 && next) snippet = `${snippet} ${next}`;
  return snippet.slice(0, max);
}

export function citationsFor(passages: Passage[], citationIds: string[]): Citation[] {
  const byId = new Map(passages.map((passage) => [passage.id, passage]));
  return citationIds
    .map((id) => byId.get(id))
    .filter((passage): passage is Passage => Boolean(passage))
    .map((passage) => ({
      id: passage.id,
      title: passage.title,
      url: passage.url,
      sourceType: passage.source_type,
      section: passage.section ?? null,
      snippet: excerpt(passage.content),
    }));
}
