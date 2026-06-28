// GET /api/admin/sync/status
// Returns the latest sync progress. Used by the admin page's polling
// client component. Requires an admin session (the optimistic proxy
// gate covers the common case, but this DAL call is the secure check).

import { NextResponse } from 'next/server';
import { getSyncProgress } from '@/lib/sync-runner';
import { getMeta, sql } from '@/lib/db';
import { requireAdmin } from '@/lib/dal';

export const dynamic = 'force-dynamic';

export async function GET() {
  await requireAdmin();
  const progress = await getSyncProgress();
  const [counts] = await sql<{
    aldi_products: number;
    ean_aldi_matches: number;
    manual_matches: number;
  }[]>`
    SELECT
      (SELECT COUNT(*)::int FROM aldi_products) AS aldi_products,
      (SELECT COUNT(*)::int FROM ean_to_aldi) AS ean_aldi_matches,
      (SELECT COUNT(*)::int FROM manual_matches) AS manual_matches
  `;
  return NextResponse.json(
    {
      progress,
      counts,
      aldiLastSync: await getMeta('aldi_sync_completed_at'),
      matchLastRun: await getMeta('match_completed_at'),
      matchLastPreserved: await getMeta('match_preserved_manual'),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
