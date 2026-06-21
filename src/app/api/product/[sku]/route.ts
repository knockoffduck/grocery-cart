import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { formatProduct } from '@/lib/format';

export const dynamic = 'force-dynamic';

// GET /api/product/:sku
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/product/[sku]'>) {
  const { sku } = await ctx.params;
  const row = db.prepare('SELECT * FROM aldi_products WHERE sku = ?').get(sku);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(formatProduct(row));
}
