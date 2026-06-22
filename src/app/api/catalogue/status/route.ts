import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/catalogue/status
// Lightweight endpoint to check whether the server catalogue is newer than
// the client's cached version. Returns 200 with metadata. The client uses
// this to decide whether to fetch the full /api/catalogue/dump.
export async function GET() {
  const [row] = await sql<{
    last_match: string | null;
    last_manual: string | null;
    product_count: number;
    fuzzy_count: number;
    manual_count: number;
  }[]>`
    SELECT
      (SELECT MAX(verified_at) FROM ean_to_aldi) AS last_match,
      (SELECT MAX(created_at) FROM manual_matches) AS last_manual,
      (SELECT COUNT(*)::int FROM aldi_products) AS product_count,
      (SELECT COUNT(*)::int FROM ean_to_aldi) AS fuzzy_count,
      (SELECT COUNT(*)::int FROM manual_matches) AS manual_count
  `;

  const last_sync = [row.last_match, row.last_manual]
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;

  return NextResponse.json({
    product_count: row.product_count,
    ean_count: row.fuzzy_count + row.manual_count,
    last_sync,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
