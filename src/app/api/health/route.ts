import { NextResponse } from 'next/server';
import { ensureAdminAuth, getMeta } from '@/lib/pb';

export const dynamic = 'force-dynamic';

// GET /api/health
// Liveness + DB diagnostic. Returns 200 when PocketBase responds; 503 otherwise.
export async function GET() {
  try {
    const pb = await ensureAdminAuth();

    const [productsRes, matchesRes, manualRes] = await Promise.all([
      pb.collection('aldi_products').getList(1, 1, { fields: 'id' }),
      pb.collection('ean_to_aldi').getList(1, 1, { fields: 'id' }),
      pb.collection('manual_matches').getList(1, 1, { fields: 'id' }),
    ]);

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        products: productsRes.totalItems,
        matches: matchesRes.totalItems,
        manual_matches: manualRes.totalItems,
      },
      last_sync: {
        aldi: (await getMeta('aldi_sync_completed_at')) ?? null,
        off: (await getMeta('off_sync_completed_at')) ?? null,
        match: (await getMeta('match_completed_at')) ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { status: 'error', error: e instanceof Error ? e.message : 'unknown' },
      { status: 503 }
    );
  }
}
