import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// PATCH /api/cart/:id/items/:sku
// Set the exact quantity (0 = remove the item).
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/cart/[id]/items/[sku]'>) {
  const { id, sku } = await ctx.params;
  const body = await request.json() as { quantity?: number };
  if (typeof body.quantity !== 'number' || body.quantity < 0) {
    return NextResponse.json({ error: 'quantity must be >= 0' }, { status: 400 });
  }
  if (body.quantity === 0) {
    db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND aldi_sku = ?').run(id, sku);
  } else {
    db.prepare(`
      INSERT INTO cart_items (cart_id, aldi_sku, quantity) VALUES (?, ?, ?)
      ON CONFLICT(cart_id, aldi_sku) DO UPDATE SET quantity = excluded.quantity
    `).run(id, sku, body.quantity);
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/cart/:id/items/:sku
// Remove a single item from the cart.
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/cart/[id]/items/[sku]'>) {
  const { id, sku } = await ctx.params;
  db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND aldi_sku = ?').run(id, sku);
  return NextResponse.json({ ok: true });
}
