import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkBodySize } from '@/lib/bodySize';

export const dynamic = 'force-dynamic';

// POST /api/manual-match
// Save a user-verified EAN -> Aldi SKU mapping. Future scans of this EAN
// resolve immediately (manual match wins over OFF fuzzy match).
export async function POST(request: NextRequest) {
  const tooBig = checkBodySize(request);
  if (tooBig) return tooBig;
  const body = await request.json() as { ean?: string; aldi_sku?: string };
  if (!body.ean || !body.aldi_sku) {
    return NextResponse.json({ error: 'ean and aldi_sku required' }, { status: 400 });
  }
  const [product] = await sql`SELECT sku FROM aldi_products WHERE sku = ${body.aldi_sku}`;
  if (!product) return NextResponse.json({ error: 'aldi product not found' }, { status: 404 });
  await sql`
    INSERT INTO manual_matches (ean, aldi_sku) VALUES (${body.ean}, ${body.aldi_sku})
    ON CONFLICT(ean) DO UPDATE SET
      aldi_sku = EXCLUDED.aldi_sku,
      created_at = NOW()
  `;
  return NextResponse.json({ ok: true, ean: body.ean, aldi_sku: body.aldi_sku });
}
