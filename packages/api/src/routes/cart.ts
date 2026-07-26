import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { ensureAdminAuth } from '../lib/pb';
import { checkBodySize } from '../lib/bodySize';

const cart = new Hono();

// POST /api/cart — Create a new cart
cart.post('/cart', async (c) => {
  const pb = await ensureAdminAuth();
  const id = randomUUID();
  await pb.collection('carts').create({ cart_id: id });
  return c.json({ cartId: id });
});

// GET /api/cart/:id — Read a cart with line items and computed totals
cart.get('/cart/:id', async (c) => {
  const id = c.req.param('id');
  const pb = await ensureAdminAuth();

  let cartRecord: any;
  try {
    cartRecord = await pb.collection('carts').getFirstListItem(`cart_id="${id}"`);
  } catch {
    return c.json({ error: 'cart not found' }, 404);
  }

  const itemsResult = await pb.collection('cart_items').getList(1, 200, {
    filter: `cart_id="${id}"`,
    sort: '-added_at',
  });

  const skus = itemsResult.items.map((it: any) => it.aldi_sku);
  const productMap = new Map<string, any>();
  if (skus.length > 0) {
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

  return c.json({ id, items, subtotal_cents: subtotal, item_count: itemCount });
});

// DELETE /api/cart/:id — Clear the cart (deletes the cart row and its items)
cart.delete('/cart/:id', async (c) => {
  const id = c.req.param('id');
  const pb = await ensureAdminAuth();

  const itemsResult = await pb.collection('cart_items').getList(1, 500, {
    filter: `cart_id="${id}"`,
    fields: 'id',
  });
  for (const item of itemsResult.items) {
    await pb.collection('cart_items').delete(item.id);
  }

  try {
    const cartRec = await pb.collection('carts').getFirstListItem(`cart_id="${id}"`);
    await pb.collection('carts').delete(cartRec.id);
  } catch {
    // Cart might not exist
  }

  return c.json({ ok: true });
});

// POST /api/cart/:id/items — Add a product to the cart
cart.post('/cart/:id/items', async (c) => {
  const tooBig = checkBodySize(c);
  if (tooBig) return tooBig;

  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { sku?: string; quantity?: number };
  if (!body.sku) return c.json({ error: 'sku required' }, 400);
  const qty = Math.max(1, Math.floor(body.quantity ?? 1));

  const pb = await ensureAdminAuth();

  let cartRecord: any;
  try {
    cartRecord = await pb.collection('carts').getFirstListItem(`cart_id="${id}"`);
  } catch {
    return c.json({ error: 'cart not found' }, 404);
  }

  let existing: any = null;
  try {
    existing = await pb.collection('cart_items').getFirstListItem(`cart_id="${id}" && aldi_sku="${body.sku}"`);
  } catch {
    // Not found
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

  await pb.collection('carts').update(cartRecord.id, { updated_at: new Date().toISOString() });
  return c.json({ ok: true });
});

// DELETE /api/cart/:id/items — Remove all items from a cart (keep cart row)
cart.delete('/cart/:id/items', async (c) => {
  const id = c.req.param('id');
  const pb = await ensureAdminAuth();

  const itemsResult = await pb.collection('cart_items').getList(1, 500, {
    filter: `cart_id="${id}"`,
    fields: 'id',
  });
  for (const item of itemsResult.items) {
    await pb.collection('cart_items').delete(item.id);
  }

  return c.json({ ok: true });
});

// PATCH /api/cart/:id/items/:sku — Set exact quantity (0 = remove)
cart.patch('/cart/:id/items/:sku', async (c) => {
  const tooBig = checkBodySize(c);
  if (tooBig) return tooBig;

  const id = c.req.param('id');
  const sku = c.req.param('sku');
  const body = await c.req.json() as { quantity?: number };
  if (typeof body.quantity !== 'number' || body.quantity < 0) {
    return c.json({ error: 'quantity must be >= 0' }, 400);
  }

  const pb = await ensureAdminAuth();

  if (body.quantity === 0) {
    try {
      const existing = await pb.collection('cart_items').getFirstListItem(`cart_id="${id}" && aldi_sku="${sku}"`);
      await pb.collection('cart_items').delete(existing.id);
    } catch {
      // Item doesn't exist
    }
  } else {
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

  return c.json({ ok: true });
});

// DELETE /api/cart/:id/items/:sku — Remove a single item
cart.delete('/cart/:id/items/:sku', async (c) => {
  const id = c.req.param('id');
  const sku = c.req.param('sku');
  const pb = await ensureAdminAuth();

  try {
    const existing = await pb.collection('cart_items').getFirstListItem(`cart_id="${id}" && aldi_sku="${sku}"`);
    await pb.collection('cart_items').delete(existing.id);
  } catch {
    // Item doesn't exist
  }

  return c.json({ ok: true });
});

export { cart as cartRoutes };
