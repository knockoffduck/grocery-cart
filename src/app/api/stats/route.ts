import { NextResponse } from 'next/server';
import { ensureAdminAuth, getMeta } from '@/lib/pb';

export const dynamic = 'force-dynamic';

// GET /api/stats
// DB stats for the diagnostic / status banner.
export async function GET() {
  const pb = await ensureAdminAuth();

  const [aldiRes, offRes, eanRes, manualRes] = await Promise.all([
    pb.collection('aldi_products').getList(1, 1, { fields: 'id' }),
    pb.collection('off_products').getList(1, 1, { fields: 'id' }),
    pb.collection('ean_to_aldi').getList(1, 1, { fields: 'id' }),
    pb.collection('manual_matches').getList(1, 1, { fields: 'id' }),
  ]);

  return NextResponse.json({
    aldi_products: aldiRes.totalItems,
    off_products: offRes.totalItems,
    ean_aldi_matches: eanRes.totalItems,
    manual_matches: manualRes.totalItems,
    aldi_last_sync: await getMeta('aldi_sync_completed_at'),
    off_last_sync: await getMeta('off_sync_completed_at'),
    match_last_run: await getMeta('match_completed_at'),
  });
}
