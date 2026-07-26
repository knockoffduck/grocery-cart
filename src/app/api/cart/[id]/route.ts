import { NextRequest, NextResponse } from 'next/server';
import { ensureAdminAuth } from '@/lib/pb';

export const dynamic = 'force-dynamic';

// GET /api/cart/:id
// Read a cart with line items and computed totals. Fetches cart_items
// then batch-fetches aldi_products so the client gets name, brand,
// image, and price without a second roundtrip.
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/cart/[id]'>) {
  const { id } = await ctx.params;
  const pb = await ensureAdminAuth();

  // Verify cart exists
  let cart: any;
  try {
    cart = await pb.collection('carts').getFirstListItem(`cart_id="${id}"`);
  } catch {
    return NextResponse.json({ error: 'cart not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  // Fetch cart items
  const itemsResult = await pb.collection('cart_items').getList(1, 200, {
    filter: `cart_id="${id}"`,
    sort: '-added_at',
  });

  // Batch-fetch product info for all SKUs
  const skus = itemsResult.items.map((it: any) => it.aldi_sku);
  const productMap = new Map<string, any>();
  if (skus.length > 0) {
    // PocketBase filter with OR for multiple SKUs
    const chunks: string[][] = [];
    for (let i = 0; i < skus.length; i += 50) {
      chunks.push(skus.slice(i, i + 50));
    }
    for (const chunk of chunks) {
      const filter = chunk.map((s) => `sku="${s}"`).join('||');
      const products = await pb.collection('aldi_products').getList(1, 50, { filter });
      for (const p of products.items) {
        productMap.set(p.sku as string, p);
      }
    }
  }

  let subtotal = 0;
  let itemCount = 0;
  const items = itemsResult.items.map((it: any) => {
    const product = productMap.get(it.aldi_sku);
    const priceCents = it.manual_price_cents || product?.price_cents || null;
    const unit = priceCents ?? 0;
    subtotal += unit * it.quantity;
    itemCount += it.quantity;
    return {
      aldi_sku: it.aldi_sku,
      quantity: it.quantity,
      manual_price_cents: it.manual_price_cents || null,
      added_at: it.added_at,
      name: product?.name ?? null,
      brand_name: product?.brand_name ?? null,
      selling_size: product?.selling_size ?? null,
      price_cents: product?.price_cents ?? null,
      primary_image: product?.primary_image ?? null,
      slug: product?.slug ?? null,
      unit_price_cents: priceCents,
      line_total_cents: unit * it.quantity,
    };
  });

  return NextResponse.json({
    id,
    items,
    subtotal_cents: subtotal,
    item_count: itemCount,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

// DELETE /api/cart/:id
// Clear the cart (deletes the cart row and its items).
export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/cart/[id]'>) {
  const { id } = await ctx.params;
  const pb = await ensureAdminAuth();

  // Delete all cart items first
  const itemsResult = await pb.collection('cart_items').getList(1, 500, {
    filter: `cart_id="${id}"`,
    fields: 'id',
  });
  for (const item of itemsResult.items) {
    await pb.collection('cart_items').delete(item.id);
  }

  // Delete the cart itself
  try {
    const cart = await pb.collection('carts').getFirstListItem(`cart_id="${id}"`);
    await pb.collection('carts').delete(cart.id);
  } catch {
    // Cart might not exist — that's fine
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
