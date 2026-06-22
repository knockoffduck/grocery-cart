import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/cart/:id/items
// Add a product to the cart. If the SKU is already in the cart we
// accumulate the quantity (a barcode scan while the same item is in the
// cart should bump qty, not create a duplicate line).
export async function POST(request: Request, ctx: RouteContext<'/api/cart/[id]/items'>) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { sku?: string; quantity?: number };
  if (!body.sku) return NextResponse.json({ error: 'sku required' }, { status: 400 });
  const qty = Math.max(1, Math.floor(body.quantity ?? 1));
  const cart = db.prepare('SELECT id FROM carts WHERE id = ?').get(id);
  if (!cart) return NextResponse.json({ error: 'cart not found' }, { status: 404 });
  const existing = db.prepare(
    'SELECT quantity FROM cart_items WHERE cart_id = ? AND aldi_sku = ?',
  ).get(id, body.sku) as { quantity: number } | undefined;
  if (existing) {
    db.prepare(
      'UPDATE cart_items SET quantity = quantity + ?, added_at = datetime(\'now\') WHERE cart_id = ? AND aldi_sku = ?',
    ).run(qty, id, body.sku);
  } else {
    db.prepare(
      'INSERT INTO cart_items (cart_id, aldi_sku, quantity) VALUES (?, ?, ?)',
    ).run(id, body.sku, qty);
  }
  db.prepare('UPDATE carts SET updated_at = datetime(\'now\') WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}

// DELETE /api/cart/:id/items
// Remove all items from a cart but keep the cart row (and its id) intact.
// The id stays the same so the client doesn't need to mint a new one and
// re-render the whole app — it just sees an empty cart. Used by the
// "Clear cart" button in the UI.
export async function DELETE(_request: Request, ctx: RouteContext<'/api/cart/[id]/items'>) {
  const { id } = await ctx.params;
  db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(id);
  return NextResponse.json({ ok: true });
}
