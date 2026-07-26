import { NextRequest, NextResponse } from 'next/server';
import { ensureAdminAuth } from '@/lib/pb';
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

  const pb = await ensureAdminAuth();

  if (body.quantity === 0) {
    // Remove the item
    try {
      const existing = await pb.collection('cart_items').getFirstListItem(`cart_id="${id}" && aldi_sku="${sku}"`);
      await pb.collection('cart_items').delete(existing.id);
    } catch {
      // Item doesn't exist — that's fine
    }
  } else {
    // Upsert: check if exists, update or create
    let existing: any = null;
    try {
      existing = await pb.collection('cart_items').getFirstListItem(`cart_id="${id}" && aldi_sku="${sku}"`);
    } catch {
      // Not found
    }

    if (existing) {
      await pb.collection('cart_items').update(existing.id, { quantity: body.quantity });
    } else {
      await pb.collection('cart_items').create({
        cart_id: id,
        aldi_sku: sku,
        quantity: body.quantity,
        added_at: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

// DELETE /api/cart/:id/items/:sku
// Remove a single item from the cart.
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/cart/[id]/items/[sku]'>) {
  const { id, sku } = await ctx.params;
  const pb = await ensureAdminAuth();

  try {
    const existing = await pb.collection('cart_items').getFirstListItem(`cart_id="${id}" && aldi_sku="${sku}"`);
    await pb.collection('cart_items').delete(existing.id);
  } catch {
    // Item doesn't exist — that's fine
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
