import { NextResponse } from 'next/server';
import { db, getMeta } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/stats
// DB stats for the diagnostic / status banner.
export async function GET() {
  const aldiCount = (db.prepare('SELECT COUNT(*) AS n FROM aldi_products').get() as any).n;
  const offCount = (db.prepare('SELECT COUNT(*) AS n FROM off_products').get() as any).n;
  const matchCount = (db.prepare('SELECT COUNT(*) AS n FROM ean_to_aldi').get() as any).n;
  const manualCount = (db.prepare('SELECT COUNT(*) AS n FROM manual_matches').get() as any).n;
  return NextResponse.json({
    aldi_products: aldiCount,
    off_products: offCount,
    ean_aldi_matches: matchCount,
    manual_matches: manualCount,
    aldi_last_sync: getMeta('aldi_sync_completed_at'),
    off_last_sync: getMeta('off_sync_completed_at'),
    match_last_run: getMeta('match_completed_at'),
  });
}
