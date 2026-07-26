import { NextResponse } from 'next/server';
import { ensureAdminAuth } from '@/lib/pb';

export const dynamic = 'force-dynamic';

// GET /api/catalogue/status
// Lightweight endpoint to check whether the server catalogue is newer than
// the client's cached version.
export async function GET() {
  const pb = await ensureAdminAuth();

  const [productRes, fuzzyRes, manualRes] = await Promise.all([
    pb.collection('aldi_products').getList(1, 1, { fields: 'id' }),
    pb.collection('ean_to_aldi').getList(1, 1, { fields: 'id' }),
    pb.collection('manual_matches').getList(1, 1, { fields: 'id' }),
  ]);

  // Get last sync timestamps
  let lastMatch: string | null = null;
  let lastManual: string | null = null;

  try {
    const latestMatch = await pb.collection('ean_to_aldi').getList(1, 1, {
      sort: '-verified_at',
      fields: 'verified_at',
    });
    if (latestMatch.items.length) lastMatch = latestMatch.items[0].verified_at as string;
  } catch { /* ignore */ }

  try {
    const latestManual = await pb.collection('manual_matches').getList(1, 1, {
      sort: '-created_at',
      fields: 'created_at',
    });
    if (latestManual.items.length) lastManual = latestManual.items[0].created_at as string;
  } catch { /* ignore */ }

  const last_sync = [lastMatch, lastManual]
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;

  return NextResponse.json({
    product_count: productRes.totalItems,
    ean_count: fuzzyRes.totalItems + manualRes.totalItems,
    last_sync,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
