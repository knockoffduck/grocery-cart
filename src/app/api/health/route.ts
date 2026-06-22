import { NextResponse } from 'next/server';
import { sql, getMeta } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/health
// Liveness + DB diagnostic. Returns 200 when SQLite responds; 503 otherwise.
export async function GET() {
  try {
    const [counts] = await sql<{ products: number; matches: number; manual: number }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM aldi_products) AS products,
        (SELECT COUNT(*)::int FROM ean_to_aldi) AS matches,
        (SELECT COUNT(*)::int FROM manual_matches) AS manual
    `;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        products: counts.products,
        matches: counts.matches,
        manual_matches: counts.manual,
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
