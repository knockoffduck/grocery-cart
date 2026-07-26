// GET /api/admin/sync/status
// Returns the latest sync progress. Used by the admin page's polling
// client component. Requires an admin session.

import { NextResponse } from 'next/server';
import { getSyncProgress } from '@/lib/sync-runner';
import { ensureAdminAuth, getMeta } from '@/lib/pb';
import { requireAdmin } from '@/lib/dal';

export const dynamic = 'force-dynamic';

export async function GET() {
  await requireAdmin();
  const pb = await ensureAdminAuth();
  const progress = await getSyncProgress();

  const [aldiRes, eanRes, manualRes] = await Promise.all([
    pb.collection('aldi_products').getList(1, 1, { fields: 'id' }),
    pb.collection('ean_to_aldi').getList(1, 1, { fields: 'id' }),
    pb.collection('manual_matches').getList(1, 1, { fields: 'id' }),
  ]);

  return NextResponse.json(
    {
      progress,
      counts: {
        aldi_products: aldiRes.totalItems,
        ean_aldi_matches: eanRes.totalItems,
        manual_matches: manualRes.totalItems,
      },
      aldiLastSync: await getMeta('aldi_sync_completed_at'),
      matchLastRun: await getMeta('match_completed_at'),
      matchLastPreserved: await getMeta('match_preserved_manual'),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
