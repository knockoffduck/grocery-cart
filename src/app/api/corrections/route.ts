import { NextRequest, NextResponse } from 'next/server';
import { ensureAdminAuth } from '@/lib/pb';
import { checkBodySize } from '@/lib/bodySize';

export const dynamic = 'force-dynamic';

// POST /api/corrections
// Append a row to the `corrections` audit trail when a user swaps a
// wrongly auto-matched scan for the right product.
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

  const pb = await ensureAdminAuth();
  await pb.collection('corrections').create({
    ean: body.ean ?? '',
    was_sku: body.was_sku,
    now_sku: body.now_sku,
    cart_id: body.cart_id ?? '',
    created_at: new Date().toISOString(),
  });

  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
