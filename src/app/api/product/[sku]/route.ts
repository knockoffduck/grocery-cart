import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { formatProduct } from '@/lib/format';

export const dynamic = 'force-dynamic';

// GET /api/product/:sku
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/product/[sku]'>) {
  const { sku } = await ctx.params;
  const [row] = await sql`SELECT * FROM aldi_products WHERE sku = ${sku}`;
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(formatProduct(row));
}
