import { NextResponse } from 'next/server';
import { ensureAdminAuth } from '@/lib/pb';
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

  const pb = await ensureAdminAuth();

  // Verify cart exists
  let cart: any;
  try {
    cart = await pb.collection('carts').getFirstListItem(`cart_id="${id}"`);
  } catch {
    return NextResponse.json({ error: 'cart not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  // Check if item already exists in cart
  let existing: any = null;
  try {
    existing = await pb.collection('cart_items').getFirstListItem(`cart_id="${id}" && aldi_sku="${body.sku}"`);
  } catch {
    // Not found — will create below
  }

  if (existing) {
    await pb.collection('cart_items').update(existing.id, {
      quantity: existing.quantity + qty,
      added_at: new Date().toISOString(),
    });
  } else {
    await pb.collection('cart_items').create({
      cart_id: id,
      aldi_sku: body.sku,
      quantity: qty,
      added_at: new Date().toISOString(),
    });
  }

  // Update cart's updated_at
  await pb.collection('carts').update(cart.id, { updated_at: new Date().toISOString() });

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

// DELETE /api/cart/:id/items
// Remove all items from a cart but keep the cart row (and its id) intact.
export async function DELETE(_request: Request, ctx: RouteContext<'/api/cart/[id]/items'>) {
  const { id } = await ctx.params;
  const pb = await ensureAdminAuth();

  const itemsResult = await pb.collection('cart_items').getList(1, 500, {
    filter: `cart_id="${id}"`,
    fields: 'id',
  });
  for (const item of itemsResult.items) {
    await pb.collection('cart_items').delete(item.id);
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
