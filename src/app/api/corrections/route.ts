import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkBodySize } from '@/lib/bodySize';

export const dynamic = 'force-dynamic';

// POST /api/corrections
// Append a row to the `corrections` audit trail when a user swaps a
// wrongly auto-matched scan for the right product. Write-only: nothing
// in the app reads this back — it exists for later bulk re-scoring of
// `ean_to_aldi` via scripts/match.ts. Best-effort: a failure here should
// not break the swap, so callers fire-and-forget.
export async function POST(request: NextRequest) {
  const tooBig = checkBodySize(request);
  if (tooBig) return tooBig;
  const body = await request.json() as {
    ean?: string | null;
    was_sku?: string;
    now_sku?: string;
    cart_id?: string | null;
  };
  if (!body.was_sku || !body.now_sku) {
    return NextResponse.json(
      { error: 'was_sku and now_sku required' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  // ean and cart_id are optional: a correction from the Cart view can't
  // recover the original barcode (cart lines don't store EAN), so we log
  // it as a cart-line swap only.
  const ean = body.ean ?? null;
  const cartId = body.cart_id ?? null;
  await sql`
    INSERT INTO corrections (ean, was_sku, now_sku, cart_id)
    VALUES (${ean}, ${body.was_sku}, ${body.now_sku}, ${cartId})
  `;
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}