import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { formatProduct, pickOff } from '@/lib/format';

export const dynamic = 'force-dynamic';

// GET /api/ean/:ean
// Lookup path: manual match -> OFF + fuzzy match -> not matched.
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/ean/[ean]'>) {
  const { ean } = await ctx.params;

  // 1. User-created manual match wins over everything (highest confidence).
  const [manual] = await sql<any[]>`
    SELECT ap.*, mm.created_at AS matched_at
    FROM manual_matches mm
    JOIN aldi_products ap ON ap.sku = mm.aldi_sku
    WHERE mm.ean = ${ean}
  `;
  if (manual) {
    return NextResponse.json({
      matched: true,
      ean,
      source: 'manual',
      best: formatProduct(manual),
      candidates: [{ score: 1.0, method: 'manual', product: formatProduct(manual) }],
    });
  }

  // 2. Otherwise, try OFF + fuzzy match.
  const [off] = await sql`SELECT * FROM off_products WHERE ean = ${ean}`;
  if (!off) {
    return NextResponse.json({
      matched: false,
      ean,
      reason: 'EAN not in Open Food Facts',
      canManualMatch: true,
    });
  }

  const matches = await sql<any[]>`
    SELECT e2a.score, e2a.method, ap.*
    FROM ean_to_aldi e2a
    JOIN aldi_products ap ON ap.sku = e2a.aldi_sku
    WHERE e2a.ean = ${ean}
    ORDER BY e2a.score DESC
    LIMIT 5
  `;

  if (!matches.length) {
    return NextResponse.json({
      matched: false,
      ean,
      off: pickOff(off),
      reason: 'EAN in OFF but no Aldi product match',
      canManualMatch: true,
    });
  }

  return NextResponse.json({
    matched: true,
    ean,
    off: pickOff(off),
    candidates: matches.map((m) => ({ score: m.score, method: m.method, product: formatProduct(m) })),
    best: formatProduct(matches[0]),
  });
}
