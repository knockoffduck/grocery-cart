import { Hono } from 'hono';
import { ensureAdminAuth } from '../lib/pb';
import { formatProduct } from '@aldi-cart/shared';

const search = new Hono();

// GET /api/search?q=...&limit=20
search.get('/search', async (c) => {
  const q = c.req.query('q')?.trim();
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 60);
  if (!q || q.length < 1) return c.json({ items: [] });

  const pb = await ensureAdminAuth();

  // PocketBase uses ~ for LIKE (case-insensitive contains)
  const filter = `name ~ "${q}" || brand_name ~ "${q}"`;
  const result = await pb.collection('aldi_products').getList(1, limit, {
    filter,
    sort: 'name',
    fields: 'sku,name,brand_name,selling_size,price_cents,primary_image,slug',
  });

  return c.json({ items: result.items.map(formatProduct) });
});

export { search as searchRoutes };
