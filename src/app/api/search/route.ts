import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { formatProduct } from '@/lib/format';

export const dynamic = 'force-dynamic';

// GET /api/search?q=...&limit=20
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10), 60);
  if (!q || q.length < 1) return NextResponse.json({ items: [] });
  const like = `%${q.toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT sku, name, brand_name, selling_size, price_cents, primary_image, slug
    FROM aldi_products
    WHERE LOWER(name) LIKE ? OR LOWER(brand_name) LIKE ?
    ORDER BY
      CASE WHEN LOWER(name) LIKE ? THEN 0 ELSE 1 END,
      CASE WHEN LOWER(brand_name) LIKE ? THEN 0 ELSE 1 END,
      name
    LIMIT ?
  `).all(like, like, `${q.toLowerCase()}%`, `${q.toLowerCase()}%`, limit);
  return NextResponse.json({ items: rows.map(formatProduct) });
}
