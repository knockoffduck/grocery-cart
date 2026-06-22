import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkBodySize } from '@/lib/bodySize';

export const dynamic = 'force-dynamic';

// POST /api/cart/:id/items
// Add a product to the cart. If the SKU is already in the cart we
// accumulate the quantity (a barcode scan while the same item is in the
// cart should bump qty, not create a duplicate line).
export async function POST(request: Request, ctx: RouteContext<'/api/cart/[id]/items'>) {
  const { id } = await ctx.params;
  const tooBig = checkBodySize(request);
  if (tooBig) return tooBig;
  const body = (await request.json().catch(() => ({}))) as { sku?: string; quantity?: number };
  if (!body.sku) return NextResponse.json({ error: 'sku required' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  const qty = Math.max(1, Math.floor(body.quantity ?? 1));
  const [cart] = await sql`SELECT id FROM carts WHERE id = ${id}`;
  if (!cart) return NextResponse.json({ error: 'cart not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const [existing] = await sql<{ quantity: number }[]>`
    SELECT quantity FROM cart_items WHERE cart_id = ${id} AND aldi_sku = ${body.sku}
  `;
  if (existing) {
    await sql`
      UPDATE cart_items SET quantity = quantity + ${qty}, added_at = NOW() WHERE cart_id = ${id} AND aldi_sku = ${body.sku}
    `;
  } else {
    await sql`
      INSERT INTO cart_items (cart_id, aldi_sku, quantity) VALUES (${id}, ${body.sku}, ${qty})
    `;
  }
  await sql`UPDATE carts SET updated_at = NOW() WHERE id = ${id}`;
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

// DELETE /api/cart/:id/items
// Remove all items from a cart but keep the cart row (and its id) intact.
// The id stays the same so the client doesn't need to mint a new one and
// re-render the whole app — it just sees an empty cart. Used by the
// "Clear cart" button in the UI.
export async function DELETE(_request: Request, ctx: RouteContext<'/api/cart/[id]/items'>) {
  const { id } = await ctx.params;
  await sql`DELETE FROM cart_items WHERE cart_id = ${id}`;
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
