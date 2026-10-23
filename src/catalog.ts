import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalize } from './intent.js';

export type ManifestSource = {
  id: string;
  title: string;
  url: string;
  final_url: string;
  captured_at: string;
  content_hash: string;
  source_type: 'manufacturer' | 'demo_policy';
  product_id: string | null;
  version: string;
  raw_path: string;
};

export type Product = {
  id: string;
  title: string;
  aliases: string[];
  url: string;
};

let cachedManifest: ManifestSource[] | undefined;
let cachedProducts: Product[] | undefined;

export function manifest(): ManifestSource[] {
  if (!cachedManifest) {
    const file = path.resolve(process.cwd(), 'data/manifest.json');
    cachedManifest = JSON.parse(readFileSync(file, 'utf8')) as ManifestSource[];
  }
  return cachedManifest;
}

export function products(): Product[] {
  if (!cachedProducts) {
    cachedProducts = manifest()
      .filter((source) => source.source_type === 'manufacturer' && source.product_id)
      .map((source) => {
        const id = source.product_id as string;
        const base = source.title.toLowerCase();
        const aliases = new Set<string>([base]);
        if (id === 'airpods-pro-3') aliases.add('airpods pro');
        if (id === 'airpods-max-2') aliases.add('airpods max');
        if (id === 'airpods-5') aliases.add('airpods 5');
        if (id === 'iphone-17') aliases.add('iphone');
        if (id === 'ipad-air') aliases.add('ipad air');
        if (id === 'ipad-pro') aliases.add('ipad pro');
        if (id === 'macbook-air') aliases.add('macbook air');
        if (id === 'macbook-pro') aliases.add('macbook pro');
        return { id, title: source.title, aliases: [...aliases], url: source.url };
      });
  }
  return cachedProducts;
}

export function productById(id: string | undefined | null): Product | undefined {
  return id ? products().find((product) => product.id === id) : undefined;
}

const POLICY_PATTERN =
  /\b(returns?|refunds?|shipping|delivery|dispatch|warranty|store polic(?:y|ies)|restocking|proof of purchase)\b/i;

const PRODUCT_FACT_PATTERN =
  /\b(battery|noise cancel|anc|transparency|water resist|dust|charging|charger|connector|controls?|display|screen|camera|chip|processor|memory|storage|ports?|weigh(?:t|s)?|heavy|speakers?|microphone|wi-?fi|bluetooth|sim|listening time|playback|video playback|fast.?charge|magsafe|usb.?c)\b/i;

export type Scope = { product?: string; productIds?: string[]; sourceType?: string };

export function inferScope(question: string): Scope {
  const policy = POLICY_PATTERN.test(question);
  const fact = PRODUCT_FACT_PATTERN.test(question);
  const q = ` ${normalize(question)} `;

  const matches = products()
    .flatMap((product) => {
      const matched = product.aliases
        .filter((alias) => q.includes(` ${normalize(alias)} `))
        .sort((a, b) => b.length - a.length)[0];
      return matched ? [{ product: product.id, name: normalize(matched) }] : [];
    })
    .filter(
      (match, _index, all) =>
        !all.some(
          (other) => other.product !== match.product && other.name.startsWith(`${match.name} `),
        ),
    );

  const unique = [...new Map(matches.map((match) => [match.product, match])).values()];
  if (policy) {
    return { sourceType: 'demo_policy', ...(unique.length ? { product: unique[0].product } : {}) };
  }
  if (unique.length === 1) return { sourceType: 'manufacturer', product: unique[0].product };
  if (unique.length > 1)
    return { sourceType: 'manufacturer', productIds: unique.map((m) => m.product) };
  if (fact) return { sourceType: 'manufacturer' };
  return {};
}

export function asksProductFact(question: string): boolean {
  return PRODUCT_FACT_PATTERN.test(question);
}

export function asksPolicy(question: string): boolean {
  return POLICY_PATTERN.test(question);
}
