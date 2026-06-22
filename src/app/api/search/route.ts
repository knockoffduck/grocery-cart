import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { formatProduct } from '@/lib/format';

export const dynamic = 'force-dynamic';

// GET /api/search?q=...&limit=20
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10), 60);
  if (!q || q.length < 1) return NextResponse.json({ items: [] });
  const like = `%${q.toLowerCase()}%`;
  const prefix = `${q.toLowerCase()}%`;
  const rows = await sql<any[]>`
    SELECT sku, name, brand_name, selling_size, price_cents, primary_image, slug
    FROM aldi_products
    WHERE name ILIKE ${like} OR brand_name ILIKE ${like}
    ORDER BY
      CASE WHEN name ILIKE ${prefix} THEN 0 ELSE 1 END,
      CASE WHEN brand_name ILIKE ${prefix} THEN 0 ELSE 1 END,
      name
    LIMIT ${limit}
  `;
  return NextResponse.json({ items: rows.map(formatProduct) });
}
