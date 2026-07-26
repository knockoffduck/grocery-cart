import { Hono } from 'hono';
import { ensureAdminAuth } from '../lib/pb';
import { formatProduct, pickOff } from '@aldi-cart/shared';

const ean = new Hono();

// GET /api/ean/:ean
// Lookup path: manual match -> OFF + fuzzy match -> not matched.
ean.get('/ean/:ean', async (c) => {
  const eanCode = c.req.param('ean');
  const pb = await ensureAdminAuth();

  // 1. User-created manual match wins over everything (highest confidence).
  let manual: any = null;
  try {
    manual = await pb.collection('manual_matches').getFirstListItem(`ean="${eanCode}"`);
  } catch {
    // No manual match
  }

  if (manual) {
    try {
      const product = await pb.collection('aldi_products').getFirstListItem(`sku="${manual.aldi_sku}"`);
      return c.json({
        matched: true,
        ean: eanCode,
        source: 'manual',
        best: formatProduct(product),
        candidates: [{ score: 1.0, method: 'manual', product: formatProduct(product) }],
      });
    } catch {
      // Product not found for manual match — fall through
    }
  }

  // 2. Otherwise, try OFF + fuzzy match.
  let off: any = null;
  try {
    off = await pb.collection('off_products').getFirstListItem(`ean="${eanCode}"`);
  } catch {
    // Not in OFF
  }

  if (!off) {
    return c.json({
      matched: false,
      ean: eanCode,
      reason: 'EAN not in Open Food Facts',
      canManualMatch: true,
    });
  }

  // 3. Look up fuzzy matches from ean_to_aldi
  const matchesResult = await pb.collection('ean_to_aldi').getList(1, 5, {
    filter: `ean="${eanCode}"`,
    sort: '-score',
  });

  if (!matchesResult.items.length) {
    return c.json({
      matched: false,
      ean: eanCode,
      off: pickOff(off),
      reason: 'EAN in OFF but no Aldi product match',
      canManualMatch: true,
    });
  }

  // Fetch products for each match
  const candidates = [];
  for (const m of matchesResult.items) {
    try {
      const product = await pb.collection('aldi_products').getFirstListItem(`sku="${m.aldi_sku}"`);
      candidates.push({ score: m.score, method: m.method, product: formatProduct(product) });
    } catch {
      // Product might have been removed
    }
  }

  if (!candidates.length) {
    return c.json({
      matched: false,
      ean: eanCode,
      off: pickOff(off),
      reason: 'EAN in OFF but no Aldi product match',
      canManualMatch: true,
    });
  }

  return c.json({
    matched: true,
    ean: eanCode,
    off: pickOff(off),
    candidates,
    best: candidates[0].product,
  });
});

export { ean as eanRoutes };
