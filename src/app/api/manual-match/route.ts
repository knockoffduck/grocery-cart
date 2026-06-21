import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/manual-match
// Save a user-verified EAN -> Aldi SKU mapping. Future scans of this EAN
// resolve immediately (manual match wins over OFF fuzzy match).
export async function POST(request: NextRequest) {
  const body = await request.json() as { ean?: string; aldi_sku?: string };
  if (!body.ean || !body.aldi_sku) {
    return NextResponse.json({ error: 'ean and aldi_sku required' }, { status: 400 });
  }
  const product = db.prepare('SELECT sku FROM aldi_products WHERE sku = ?').get(body.aldi_sku);
  if (!product) return NextResponse.json({ error: 'aldi product not found' }, { status: 404 });
  db.prepare(`
    INSERT INTO manual_matches (ean, aldi_sku) VALUES (?, ?)
    ON CONFLICT(ean) DO UPDATE SET
      aldi_sku = excluded.aldi_sku,
      created_at = datetime('now')
  `).run(body.ean, body.aldi_sku);
  return NextResponse.json({ ok: true, ean: body.ean, aldi_sku: body.aldi_sku });
}
