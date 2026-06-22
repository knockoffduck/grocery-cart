import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkBodySize } from '@/lib/bodySize';

export const dynamic = 'force-dynamic';

// PATCH /api/cart/:id/items/:sku
// Set the exact quantity (0 = remove the item).
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/cart/[id]/items/[sku]'>) {
  const { id, sku } = await ctx.params;
  const tooBig = checkBodySize(request);
  if (tooBig) return tooBig;
  const body = await request.json() as { quantity?: number };
  if (typeof body.quantity !== 'number' || body.quantity < 0) {
    return NextResponse.json({ error: 'quantity must be >= 0' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  if (body.quantity === 0) {
    await sql`DELETE FROM cart_items WHERE cart_id = ${id} AND aldi_sku = ${sku}`;
  } else {
    await sql`
      INSERT INTO cart_items (cart_id, aldi_sku, quantity) VALUES (${id}, ${sku}, ${body.quantity})
      ON CONFLICT(cart_id, aldi_sku) DO UPDATE SET quantity = EXCLUDED.quantity
    `;
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

// DELETE /api/cart/:id/items/:sku
// Remove a single item from the cart.
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/cart/[id]/items/[sku]'>) {
  const { id, sku } = await ctx.params;
  await sql`DELETE FROM cart_items WHERE cart_id = ${id} AND aldi_sku = ${sku}`;
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
