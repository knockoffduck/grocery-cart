import { Hono } from 'hono';
import { ensureAdminAuth } from '../lib/pb';
import { checkBodySize } from '../lib/bodySize';

const manualMatch = new Hono();

// POST /api/manual-match
// Save a user-verified EAN -> Aldi SKU mapping. Future scans of this EAN
// resolve immediately (manual match wins over OFF fuzzy match).
manualMatch.post('/manual-match', async (c) => {
  const tooBig = checkBodySize(c);
  if (tooBig) return tooBig;

  const body = await c.req.json() as { ean?: string; aldi_sku?: string };
  if (!body.ean || !body.aldi_sku) {
    return c.json({ error: 'ean and aldi_sku required' }, 400);
  }

  const pb = await ensureAdminAuth();

  // Verify the Aldi product exists
  try {
    await pb.collection('aldi_products').getFirstListItem(`sku="${body.aldi_sku}"`);
  } catch {
    return c.json({ error: 'aldi product not found' }, 404);
  }

  // Upsert: check if manual match already exists for this EAN
  let existing: any = null;
  try {
    existing = await pb.collection('manual_matches').getFirstListItem(`ean="${body.ean}"`);
  } catch {
    // Not found
  }

  if (existing) {
    await pb.collection('manual_matches').update(existing.id, {
      aldi_sku: body.aldi_sku,
      created_at: new Date().toISOString(),
    });
  } else {
    await pb.collection('manual_matches').create({
      ean: body.ean,
      aldi_sku: body.aldi_sku,
      created_at: new Date().toISOString(),
    });
  }

  return c.json({ ok: true, ean: body.ean, aldi_sku: body.aldi_sku });
});

export { manualMatch as manualMatchRoutes };
