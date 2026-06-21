import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/cart/:id/items
// Add an item to the cart. UPSERT on (cart_id, aldi_sku) so re-adding
// increments the quantity rather than creating duplicate rows.
export async function POST(request: NextRequest, ctx: RouteContext<'/api/cart/[id]/items'>) {
  const { id } = await ctx.params;
  const body = await request.json() as { sku?: string; quantity?: number; manual_price_cents?: number };
  if (!body.sku) return NextResponse.json({ error: 'sku required' }, { status: 400 });
  const cart = db.prepare('SELECT id FROM carts WHERE id = ?').get(id);
  if (!cart) return NextResponse.json({ error: 'cart not found' }, { status: 404 });
  const result = db.prepare(`
    INSERT INTO cart_items (cart_id, aldi_sku, quantity, manual_price_cents)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cart_id, aldi_sku) DO UPDATE SET
      quantity = quantity + excluded.quantity,
      manual_price_cents = excluded.manual_price_cents
  `).run(id, body.sku, body.quantity ?? 1, body.manual_price_cents ?? null);
  db.prepare("UPDATE carts SET updated_at = datetime('now') WHERE id = ?").run(id);
  return NextResponse.json({ ok: true, changes: result.changes });
}
