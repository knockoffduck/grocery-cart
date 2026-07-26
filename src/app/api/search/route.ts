import { NextRequest, NextResponse } from 'next/server';
import { ensureAdminAuth } from '@/lib/pb';
import { formatProduct } from '@/lib/format';

export const dynamic = 'force-dynamic';

// GET /api/search?q=...&limit=20
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10), 60);
  if (!q || q.length < 1) return NextResponse.json({ items: [] });

  const pb = await ensureAdminAuth();

  // PocketBase uses ~ for LIKE (case-insensitive contains)
  const filter = `name ~ "${q}" || brand_name ~ "${q}"`;
  const result = await pb.collection('aldi_products').getList(1, limit, {
    filter,
    sort: 'name',
    fields: 'sku,name,brand_name,selling_size,price_cents,primary_image,slug',
  });

  return NextResponse.json({ items: result.items.map(formatProduct) });
}
