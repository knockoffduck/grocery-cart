// OFF -> Aldi matcher (reusable).
// Manual matches are never touched or recomputed.

import { ensureAdminAuth, setMeta } from './pb';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'with', 'of', 'for', 'in', 'on', 'at',
  'pack', 'pk', 'x', 'new', 'fresh', 'value', 'family', 'size', 'large',
  'small', 'mini', 'big', 'extra', 'free', 'range', 'brand', 'premium',
]);

function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s\-/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function normalizeBrand(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function brandScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const at = new Set(a.split(' ').filter(Boolean));
  const bt = new Set(b.split(' ').filter(Boolean));
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter++;
  const union = new Set([...at, ...bt]).size;
  return union === 0 ? 0 : inter / union;
}

function extractSize(s: string | null | undefined): { value: number; unit: string } | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(kg|g|mg|l|ml|cl)/i);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: m[2].toLowerCase() };
}

function sizeMatchBonus(off: string | null, aldi: string | null): number {
  const a = extractSize(off);
  const b = extractSize(aldi);
  if (!a || !b) return 0;
  if (a.unit !== b.unit) return 0;
  if (a.value === b.value) return 0.3;
  const diff = Math.abs(a.value - b.value) / Math.max(a.value, b.value);
  return diff < 0.2 ? 0.15 : 0;
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

type OffRow = { ean: string; product_name: string | null; brand: string | null; quantity: string | null };
type AldiRow = { sku: string; name: string; brand_name: string | null; selling_size: string | null };

export type MatchResult = {
  matches: number;
  exact: number;
  fuzzy: number;
  unmatched: number;
  preservedManual: number;
  elapsedMs: number;
};

export async function runMatch(
  opts: { log?: (msg: string) => void } = {},
): Promise<MatchResult> {
  const log = opts.log ?? ((m) => console.log(m));
  await setMeta('match_status', 'running');
  await setMeta('match_error', '');

  const start = Date.now();
  try {
    const pb = await ensureAdminAuth();

    const manualEans = new Set<string>();
    let page = 1;
    while (true) {
      const result = await pb.collection('manual_matches').getList(page, 500, { fields: 'ean' });
      for (const r of result.items) manualEans.add(r.ean as string);
      if (page >= result.totalPages) break;
      page++;
    }
    const preservedManual = manualEans.size;

    const off: OffRow[] = [];
    page = 1;
    while (true) {
      const result = await pb.collection('off_products').getList(page, 500, {
        fields: 'ean,product_name,brand,quantity',
      });
      for (const r of result.items) {
        if (!manualEans.has(r.ean as string)) {
          off.push({
            ean: r.ean as string,
            product_name: (r.product_name as string) ?? null,
            brand: (r.brand as string) ?? null,
            quantity: (r.quantity as string) ?? null,
          });
        }
      }
      if (page >= result.totalPages) break;
      page++;
    }

    const aldi: AldiRow[] = [];
    page = 1;
    while (true) {
      const result = await pb.collection('aldi_products').getList(page, 500, {
        fields: 'sku,name,brand_name,selling_size',
      });
      for (const r of result.items) {
        aldi.push({
          sku: r.sku as string,
          name: r.name as string,
          brand_name: (r.brand_name as string) ?? null,
          selling_size: (r.selling_size as string) ?? null,
        });
      }
      if (page >= result.totalPages) break;
      page++;
    }

    log(`[match] OFF rows: ${off.length} (excluded ${preservedManual} manual), Aldi rows: ${aldi.length}`);

    const aldiByBrandKey = new Map<string, AldiRow[]>();
    for (const a of aldi) {
      const key = normalizeBrand(a.brand_name);
      if (!key) continue;
      const arr = aldiByBrandKey.get(key) ?? [];
      arr.push(a);
      aldiByBrandKey.set(key, arr);
    }

    const matches: [string, string, number, string][] = [];
    let exact = 0;
    let fuzzy = 0;
    let noMatch = 0;

    for (const o of off) {
      if (!o.ean) continue;
      const offBrand = normalizeBrand(o.brand);
      const offTokens = tokenize(o.product_name);
      if (!offTokens.length) { noMatch++; continue; }

      const candidates: { row: AldiRow; bScore: number }[] = [];
      for (const [aldiKey, rows] of aldiByBrandKey) {
        const bs = brandScore(offBrand, aldiKey);
        if (bs >= 0.5) {
          for (const r of rows) candidates.push({ row: r, bScore: bs });
        }
      }

      if (!candidates.length) { noMatch++; continue; }

      let best: { row: AldiRow; score: number; method: string } | null = null;
      for (const { row, bScore } of candidates) {
        const aTokens = tokenize(row.name);
        const nameScore = jaccard(offTokens, aTokens);
        const sizeBonus = sizeMatchBonus(o.quantity, row.selling_size);
        const score = bScore * 0.4 + nameScore * 0.5 + sizeBonus;
        const method =
          bScore === 1 && nameScore > 0.6 ? 'exact_brand_name' :
          bScore === 1 ? 'exact_brand_partial_name' :
          nameScore > 0.5 ? 'fuzzy_brand_strong_name' : 'fuzzy';
        if (!best || score > best.score) best = { row, score, method };
      }

      if (best && best.score >= 0.4) {
        matches.push([o.ean, best.row.sku, best.score, best.method]);
        if (best.method === 'exact_brand_name') exact++;
        else fuzzy++;
      } else {
        noMatch++;
      }
    }

    // Delete existing fuzzy rows (not manual) and insert new matches
    let deleted = 0;
    while (true) {
      const result = await pb.collection('ean_to_aldi').getList(1, 200, { fields: 'id,ean' });
      if (!result.items.length) break;
      const toDelete = result.items.filter((r) => !manualEans.has(r.ean as string));
      if (!toDelete.length) break;
      const delRequests = toDelete.map((r) => ({
        method: 'DELETE',
        url: `/api/collections/ean_to_aldi/records/${r.id}`,
      }));
      for (let i = 0; i < delRequests.length; i += 100) {
        await pb.send('/api/batch', { method: 'POST', body: { requests: delRequests.slice(i, i + 100) } });
      }
      deleted += toDelete.length;
      if (deleted > 50000) break;
    }

    const insertRequests = matches.map(([ean, sku, score, method]) => ({
      method: 'POST',
      url: '/api/collections/ean_to_aldi/records',
      body: { ean, aldi_sku: sku, score, method, verified_at: new Date().toISOString() },
    }));
    for (let i = 0; i < insertRequests.length; i += 100) {
      await pb.send('/api/batch', { method: 'POST', body: { requests: insertRequests.slice(i, i + 100) } });
    }

    const completedAt = new Date().toISOString();
    await setMeta('match_status', 'done');
    await setMeta('match_completed_at', completedAt);
    await setMeta('match_total', String(matches.length));
    await setMeta('match_exact', String(exact));
    await setMeta('match_fuzzy', String(fuzzy));
    await setMeta('match_unmatched', String(noMatch));
    await setMeta('match_preserved_manual', String(preservedManual));

    const elapsedMs = Date.now() - start;
    log(`[match] done in ${(elapsedMs / 1000).toFixed(1)}s — ${matches.length} matches (${exact} exact, ${fuzzy} fuzzy), ${noMatch} unmatched, ${preservedManual} manual preserved`);

    return { matches: matches.length, exact, fuzzy, unmatched: noMatch, preservedManual, elapsedMs };
  } catch (e: any) {
    await setMeta('match_status', 'error');
    await setMeta('match_error', e?.message ?? String(e));
    throw e;
  }
}
