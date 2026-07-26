import { Hono } from 'hono';
import { ensureAdminAuth } from '../lib/pb';
import { formatProduct } from '@aldi-cart/shared';

const product = new Hono();

// GET /api/product/:sku
product.get('/product/:sku', async (c) => {
  const sku = c.req.param('sku');
  const pb = await ensureAdminAuth();
  try {
    const row = await pb.collection('aldi_products').getFirstListItem(`sku="${sku}"`);
    return c.json(formatProduct(row));
  } catch {
    return c.json({ error: 'not found' }, 404);
  }
});

export { product as productRoutes };
