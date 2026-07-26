import { NextRequest, NextResponse } from 'next/server';
import { ensureAdminAuth } from '@/lib/pb';
import { formatProduct, pickOff } from '@/lib/format';

export const dynamic = 'force-dynamic';

// GET /api/ean/:ean
// Lookup path: manual match -> OFF + fuzzy match -> not matched.
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/ean/[ean]'>) {
  const { ean } = await ctx.params;
  const pb = await ensureAdminAuth();

  // 1. User-created manual match wins over everything (highest confidence).
  let manual: any = null;
  try {
    manual = await pb.collection('manual_matches').getFirstListItem(`ean="${ean}"`);
  } catch {
    // No manual match
  }

  if (manual) {
    // Fetch the matched product
    try {
      const product = await pb.collection('aldi_products').getFirstListItem(`sku="${manual.aldi_sku}"`);
      return NextResponse.json({
        matched: true,
        ean,
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
    off = await pb.collection('off_products').getFirstListItem(`ean="${ean}"`);
  } catch {
    // Not in OFF
  }

  if (!off) {
    return NextResponse.json({
      matched: false,
      ean,
      reason: 'EAN not in Open Food Facts',
      canManualMatch: true,
    });
  }

  // 3. Look up fuzzy matches from ean_to_aldi
  const matchesResult = await pb.collection('ean_to_aldi').getList(1, 5, {
    filter: `ean="${ean}"`,
    sort: '-score',
  });

  if (!matchesResult.items.length) {
    return NextResponse.json({
      matched: false,
      ean,
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
    return NextResponse.json({
      matched: false,
      ean,
      off: pickOff(off),
      reason: 'EAN in OFF but no Aldi product match',
      canManualMatch: true,
    });
  }

  return NextResponse.json({
    matched: true,
    ean,
    off: pickOff(off),
    candidates,
    best: candidates[0].product,
  });
}
