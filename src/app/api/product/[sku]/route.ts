import { NextRequest, NextResponse } from 'next/server';
import { ensureAdminAuth } from '@/lib/pb';
import { formatProduct } from '@/lib/format';

export const dynamic = 'force-dynamic';

// GET /api/product/:sku
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/product/[sku]'>) {
  const { sku } = await ctx.params;
  const pb = await ensureAdminAuth();
  try {
    const row = await pb.collection('aldi_products').getFirstListItem(`sku="${sku}"`);
    return NextResponse.json(formatProduct(row));
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
