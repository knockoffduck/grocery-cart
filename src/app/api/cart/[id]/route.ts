import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/cart/:id
// Read a cart with line items and computed totals. Joins against aldi_products
// so the client gets name, brand, image, and price without a second roundtrip.
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/cart/[id]'>) {
  const { id } = await ctx.params;
  const cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(id);
  if (!cart) return NextResponse.json({ error: 'cart not found' }, { status: 404 });
  const items = db.prepare(`
    SELECT ci.aldi_sku, ci.quantity, ci.manual_price_cents, ci.added_at,
           ap.name, ap.brand_name, ap.selling_size, ap.price_cents, ap.primary_image, ap.slug
    FROM cart_items ci
    JOIN aldi_products ap ON ap.sku = ci.aldi_sku
    WHERE ci.cart_id = ?
    ORDER BY ci.added_at DESC
  `).all(id) as any[];

  let subtotal = 0;
  let itemCount = 0;
  for (const it of items) {
    const unit = it.manual_price_cents ?? it.price_cents ?? 0;
    subtotal += unit * it.quantity;
    itemCount += it.quantity;
  }
  return NextResponse.json({
    id,
    items: items.map((it) => ({
      ...it,
      unit_price_cents: it.manual_price_cents ?? it.price_cents,
      line_total_cents: (it.manual_price_cents ?? it.price_cents ?? 0) * it.quantity,
    })),
    subtotal_cents: subtotal,
    item_count: itemCount,
  });
}

// DELETE /api/cart/:id
// Clear the cart (deletes the cart row, cascades to items).
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/cart/[id]'>) {
  const { id } = await ctx.params;
  db.prepare('DELETE FROM carts WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
