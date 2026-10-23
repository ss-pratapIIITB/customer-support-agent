import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { config } from './config.js';
import { manifest, type ManifestSource } from './catalog.js';
import { query, withTransaction } from './db.js';
import {
  cachedEmbeddings,
  contentHash,
  embeddingEnabled,
  estimateTokens,
  vectorLiteral,
} from './embeddings.js';
import { logger } from './logger.js';

const CHUNKER_VERSION = '2.0.0';
const MAX_CHUNK = 1200;
const OVERLAP = 160;

type Block = { kind: 'heading' | 'text'; text: string };
export type DocumentSection = { section: string; text: string };

const SECTION_LABEL =
  /^(?:audio technology|hearing health|live translation|sensors|chip|controls|dust,? sweat,? and water resist\w*|size and weight.*|charging case|battery(?: and power)?|connectivity|in the box|accessibility|system requirements|capacity|display|camera|video recording|true.?depth|face id|power and battery|operating system|memory|storage|charging and expansion|keyboard and trackpad|dimensions|weight|finish|price|processor|graphics|neural engine|media engine|video playback|audio playback|display support|ports?|wireless|cellular|sim|security|apple pay|siri|environment|materials|packaging|energy|waste|smarter chemistry|models?|product image|overview)\b/i;

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function isSectionHeading(block: Block): boolean {
  if (block.kind === 'heading') {
    return !/^(?:model \d|13-inch|15-inch|11-inch|product image)$/i.test(block.text);
  }
  const text = block.text.replace(/\s*\d{1,2}$/, '').trim();
  if (text.length === 0 || text.length > 72) return false;
  if (/[.!?;:]$/.test(text)) return false;
  if (/^(?:model \d|13-inch|15-inch|11-inch|\d)/i.test(text)) return false;
  return SECTION_LABEL.test(text);
}

function blocksFromHtml(html: string): Block[] {
  const $ = load(html);
  $('script,style,nav,header,footer,noscript,svg,picture,iframe').remove();
  $('[class*="footer"], [class*="globalnav"], [class*="localnav"]').remove();
  const root = $('main').length ? $('main') : $('body');
  const blocks: Block[] = [];
  const seen = new Set<string>();

  root
    .find(
      'h1,h2,h3,h4,li,p,dt,dd,.techspecs-rowheader,.techspecs-subheader,.techspecs-subheadline,.caption-headline',
    )
    .each((_, element) => {
      const tag = element.tagName.toLowerCase();
      const hasNested = $(element).find('h1,h2,h3,h4,li,p,dt,dd').length > 0;
      if (hasNested) return;
      const text = cleanText($(element).text());
      if (!text || text.length > 4000) return;
      if (seen.has(text)) return;
      seen.add(text);
      const headingClass = String($(element).attr('class') ?? '').includes('header');
      const kind =
        tag.startsWith('h') || headingClass || String($(element).attr('class')).includes('headline')
          ? 'heading'
          : 'text';
      blocks.push({ kind, text });
    });

  const footnotes = $('[id^="footnote-"]')
    .map((_, element) => cleanText($(element).text()))
    .get()
    .filter((text) => text.length > 20 && text.toLowerCase().startsWith('source footnote'));
  if (footnotes.length) {
    blocks.push({ kind: 'heading', text: 'Notes' });
    for (const footnote of [...new Set(footnotes)]) blocks.push({ kind: 'text', text: footnote });
  }
  return blocks;
}

export function extractDocumentSections(source: ManifestSource, raw: string): DocumentSection[] {
  if (source.source_type === 'demo_policy') {
    const lines = raw.split('\n').map(cleanText).filter(Boolean);
    const title = lines[0] ?? source.title;
    const section = title.includes('—') ? title.split('—').pop()!.trim() : source.title;
    return [{ section, text: lines.slice(1).join('\n') || lines.join('\n') }];
  }

  const blocks = blocksFromHtml(raw);
  const sections: DocumentSection[] = [];
  let current: DocumentSection = { section: 'Overview', text: '' };
  for (const block of blocks) {
    if (isSectionHeading(block)) {
      if (current.text.trim()) sections.push(current);
      current = { section: block.text.replace(/\s*\d{1,2}$/, '').trim(), text: '' };
    } else {
      current.text += `${block.text}\n`;
    }
  }
  if (current.text.trim()) sections.push(current);
  if (!sections.length) {
    sections.push({ section: 'Overview', text: blocks.map((b) => b.text).join('\n') });
  }
  return sections.filter((section) => section.text.trim().length > 0);
}

function chunkText(text: string, max = MAX_CHUNK): string[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (line.length > max) {
      const words = line.split(/\s+/);
      for (const word of words) {
        if ((current + ' ' + word).trim().length > max && current) {
          chunks.push(current.trim());
          current = current.slice(-OVERLAP);
        }
        current += ` ${word}`;
      }
      continue;
    }
    if ((current + '\n' + line).trim().length > max && current) {
      chunks.push(current.trim());
      current = current.slice(-OVERLAP);
    }
    current += `${current ? '\n' : ''}${line}`;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text.slice(0, max)];
}

export type IngestedChunk = {
  id: string;
  sourceId: string;
  content: string;
  section: string;
  ordinal: number;
  textForEmbedding: string;
};

export function buildChunks(source: ManifestSource, raw: string): IngestedChunk[] {
  const sections = extractDocumentSections(source, raw);
  const chunks: IngestedChunk[] = [];
  let ordinal = 0;
  for (const section of sections) {
    for (const text of chunkText(section.text)) {
      const content = `${source.title} — ${section.section}\n${text}`;
      chunks.push({
        id: contentHash(`${source.id}:${ordinal}:${content}`).slice(0, 28),
        sourceId: `${source.id}@${source.version}`,
        content,
        section: section.section,
        ordinal,
        textForEmbedding: content,
      });
      ordinal += 1;
    }
  }
  return chunks;
}

export function corpusVersion(extra = ''): string {
  return contentHash(
    JSON.stringify([
      CHUNKER_VERSION,
      embeddingEnabled ? config.EMBEDDING_MODEL : 'lexical-only',
      manifest().map((source) => [source.id, source.version]),
      extra,
    ]),
  );
}

export async function ingest(options: { fault?: string } = {}): Promise<{
  version: string;
  status: string;
  unchanged?: boolean;
  sources: number;
  chunks: number;
  embeddingCalls: number;
}> {
  const fault = options.fault;
  const version =
    fault === 'ingestion_interrupt' || fault === 'ingestion-interruption'
      ? `${corpusVersion()}-interrupted`
      : corpusVersion();
  const active = await query<{ id: string }>(
    `SELECT id FROM corpus_versions WHERE status='active'`,
  );
  if (active.rows[0]?.id === version && !fault) {
    const counts = await query<{ sources: number; chunks: number }>(
      `SELECT count(DISTINCT source_id)::int AS sources, count(*)::int AS chunks
         FROM chunks WHERE corpus_version=$1`,
      [version],
    );
    return {
      version,
      status: 'active',
      unchanged: true,
      sources: counts.rows[0]?.sources ?? 0,
      chunks: counts.rows[0]?.chunks ?? 0,
      embeddingCalls: 0,
    };
  }

  await query(
    `INSERT INTO corpus_versions(id,status) VALUES($1,'staging')
     ON CONFLICT (id) DO UPDATE SET status = CASE WHEN corpus_versions.status='active' THEN 'active' ELSE 'staging' END, error=NULL`,
    [version],
  );

  try {
    const sources = manifest();
    if (sources.length < 6) throw new Error('Expected at least six preserved source documents');

    const prepared: Array<{ source: ManifestSource; chunks: IngestedChunk[] }> = [];
    for (const source of sources) {
      const raw = await readFile(path.resolve(process.cwd(), source.raw_path), 'utf8');
      if (contentHash(raw) !== source.content_hash) {
        throw new Error(
          `Snapshot hash mismatch for ${source.id}; refusing to ingest changed corpus`,
        );
      }
      const chunks = buildChunks(source, raw);
      if (!chunks.length) throw new Error(`No text extracted for ${source.id}`);
      prepared.push({ source, chunks });
    }

    await withTransaction(async (client) => {
      for (const { source } of prepared) {
        await client.query(
          `INSERT INTO sources(id,title,url,source_type,product_id,version,manifest)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET title=excluded.title,url=excluded.url,version=excluded.version,manifest=excluded.manifest`,
          [
            `${source.id}@${source.version}`,
            source.title,
            source.url,
            source.source_type,
            source.product_id,
            source.version,
            JSON.stringify(source),
          ],
        );
      }
      await client.query('DELETE FROM chunks WHERE corpus_version=$1', [version]);
    });

    const allChunks = prepared.flatMap((entry) => entry.chunks);
    let embeddingCalls = 0;
    let vectors: number[][] = allChunks.map(() => []);
    if (embeddingEnabled) {
      const result = await cachedEmbeddings(
        allChunks.map((chunk) => chunk.textForEmbedding),
        'ingestion-embedding',
      );
      vectors = result.vectors;
      embeddingCalls = result.calls;
    }

    let written = 0;
    for (let index = 0; index < allChunks.length; index += 50) {
      const batch = allChunks.slice(index, index + 50);
      await withTransaction(async (client) => {
        for (let offset = 0; offset < batch.length; offset += 1) {
          const chunk = batch[offset];
          const vector = vectors[index + offset];
          await client.query(
            `INSERT INTO chunks(id,corpus_version,source_id,content,section,ordinal,token_estimate,embedding)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (corpus_version,id) DO NOTHING`,
            [
              chunk.id,
              version,
              chunk.sourceId,
              chunk.content,
              chunk.section,
              chunk.ordinal,
              estimateTokens(chunk.content),
              vector?.length ? vectorLiteral(vector) : null,
            ],
          );
          written += 1;
        }
      });
      if ((fault === 'ingestion_interrupt' || fault === 'ingestion-interruption') && index === 0) {
        throw new Error('Simulated ingestion interruption after partial staging writes');
      }
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE corpus_versions SET status='retired' WHERE status='active' AND id<>$1`,
        [version],
      );
      await client.query(
        `UPDATE corpus_versions SET status='active',activated_at=now(),error=NULL WHERE id=$1`,
        [version],
      );
    });

    logger.info({ version, sources: sources.length, chunks: written }, 'Corpus activated');
    return {
      version,
      status: 'active',
      sources: sources.length,
      chunks: written,
      embeddingCalls,
    };
  } catch (error) {
    await query(`UPDATE corpus_versions SET error=$2 WHERE id=$1`, [
      version,
      error instanceof Error ? error.message : String(error),
    ]);
    throw error;
  }
}

export async function getIngestionStatus() {
  const versions = await query<{
    id: string;
    status: string;
    created_at: string;
    activated_at: string | null;
    error: string | null;
  }>(
    `SELECT id,status,created_at,activated_at,error FROM corpus_versions ORDER BY created_at DESC LIMIT 20`,
  );
  const active = versions.rows.find((row) => row.status === 'active');
  let chunks = 0;
  let sources = 0;
  let embedded = 0;
  if (active) {
    const counts = await query<{ chunks: number; sources: number; embedded: number }>(
      `SELECT count(*)::int AS chunks, count(DISTINCT source_id)::int AS sources,
              count(embedding)::int AS embedded
         FROM chunks WHERE corpus_version=$1`,
      [active.id],
    );
    chunks = counts.rows[0]?.chunks ?? 0;
    sources = counts.rows[0]?.sources ?? 0;
    embedded = counts.rows[0]?.embedded ?? 0;
  }
  return {
    ready: Boolean(active),
    activeVersion: active?.id ?? null,
    sources,
    chunks,
    embedded,
    lexicalOnly: !embeddingEnabled || embedded === 0,
    versions: versions.rows,
  };
}

export async function listSources() {
  return (
    await query(
      `SELECT s.id, s.title, s.url, s.source_type, s.product_id, s.version,
              count(c.id)::int AS chunks, count(c.embedding)::int AS embedded
         FROM sources s
         JOIN chunks c ON c.source_id = s.id
         JOIN corpus_versions v ON v.id = c.corpus_version AND v.status='active'
        GROUP BY s.id ORDER BY s.source_type DESC, s.title`,
    )
  ).rows;
}

export async function getSource(sourceId: string) {
  return (
    await query<{ manifest: ManifestSource }>(`SELECT manifest FROM sources WHERE id=$1`, [
      sourceId,
    ])
  ).rows[0];
}
