import { NextResponse } from 'next/server';
import { sql, getMeta } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/stats
// DB stats for the diagnostic / status banner.
export async function GET() {
  const [counts] = await sql<{
    aldi_products: number;
    off_products: number;
    ean_aldi_matches: number;
    manual_matches: number;
  }[]>`
    SELECT
      (SELECT COUNT(*)::int FROM aldi_products) AS aldi_products,
      (SELECT COUNT(*)::int FROM off_products) AS off_products,
      (SELECT COUNT(*)::int FROM ean_to_aldi) AS ean_aldi_matches,
      (SELECT COUNT(*)::int FROM manual_matches) AS manual_matches
  `;
  return NextResponse.json({
    aldi_products: counts.aldi_products,
    off_products: counts.off_products,
    ean_aldi_matches: counts.ean_aldi_matches,
    manual_matches: counts.manual_matches,
    aldi_last_sync: await getMeta('aldi_sync_completed_at'),
    off_last_sync: await getMeta('off_sync_completed_at'),
    match_last_run: await getMeta('match_completed_at'),
  });
}
