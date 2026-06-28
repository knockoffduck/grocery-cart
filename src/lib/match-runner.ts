// OFF -> Aldi matcher (reusable).
//
// Behaviour:
//   - For every (off, aldi) pair, score by Jaccard name tokens + brand
//     overlap + size bonus; pick the best match above a 0.4 threshold.
//   - **Manual matches (manual_matches) are never touched or recomputed.**
//     EANs with a manual match are skipped entirely; existing
//     ean_to_aldi rows whose ean is in manual_matches are also kept
//     (we DELETE FROM ean_to_aldi using NOT EXISTS against
//     manual_matches).
//   - Idempotent: rebuilds fuzzy rows on every run.
//
// The CLI `npm run match` and the admin-triggered auto-match both
// call runMatch(). Progress is reported to the `meta` table so the
// admin UI can show "matching…" status.

import { sql, setMeta } from './db.js';

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

/**
 * Run the OFF->Aldi match pass. Manual matches are never overwritten.
 */
export async function runMatch(
  opts: { log?: (msg: string) => void } = {},
): Promise<MatchResult> {
  const log = opts.log ?? ((m) => console.log(m));
  await setMeta('match_status', 'running');
  await setMeta('match_error', '');

  const start = Date.now();
  try {
    // Pull OFF + Aldi rows. We EXCLUDE EANs that are already in
    // manual_matches so we don't waste cycles recomputing what a
    // human already locked in.
    const off = (await sql<OffRow[]>`
      SELECT op.ean, op.product_name, op.brand, op.quantity
      FROM off_products op
      WHERE NOT EXISTS (
        SELECT 1 FROM manual_matches mm WHERE mm.ean = op.ean
      )
    `) as OffRow[];

    const aldi = (await sql<AldiRow[]>`
      SELECT sku, name, brand_name, selling_size FROM aldi_products
    `) as AldiRow[];

    const [manualCount] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM manual_matches
    `;
    const preservedManual = manualCount?.count ?? 0;

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

    // Replace fuzzy rows only — leave any ean_to_aldi row whose ean
    // is in manual_matches untouched.
    await sql.begin(async (s) => {
      await s`
        DELETE FROM ean_to_aldi
        WHERE NOT EXISTS (
          SELECT 1 FROM manual_matches mm WHERE mm.ean = ean_to_aldi.ean
        )
      `;
      for (const [ean, sku, score, method] of matches) {
        await s`
          INSERT INTO ean_to_aldi (ean, aldi_sku, score, method)
          VALUES (${ean}, ${sku}, ${score}, ${method})
          ON CONFLICT (ean, aldi_sku) DO UPDATE
          SET score = EXCLUDED.score, method = EXCLUDED.method
        `;
      }
    });

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
