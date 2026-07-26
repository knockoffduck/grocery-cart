import { Hono } from 'hono';
import { ensureAdminAuth } from '../lib/pb';
import { checkBodySize } from '../lib/bodySize';

const corrections = new Hono();

// POST /api/corrections
// Append a row to the `corrections` audit trail when a user swaps a
// wrongly auto-matched scan for the right product.
corrections.post('/corrections', async (c) => {
  const tooBig = checkBodySize(c);
  if (tooBig) return tooBig;

  const body = await c.req.json() as {
    ean?: string | null;
    was_sku?: string;
    now_sku?: string;
    cart_id?: string | null;
  };
  if (!body.was_sku || !body.now_sku) {
    return c.json({ error: 'was_sku and now_sku required' }, 400);
  }

  const pb = await ensureAdminAuth();
  await pb.collection('corrections').create({
    ean: body.ean ?? '',
    was_sku: body.was_sku,
    now_sku: body.now_sku,
    cart_id: body.cart_id ?? '',
    created_at: new Date().toISOString(),
  });

  return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
});

export { corrections as correctionsRoutes };
