import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ensureAdminAuth } from '@/lib/pb';

export const dynamic = 'force-dynamic';

// POST /api/cart
// Create a new cart, returns the new cartId. The client stores it in
// localStorage and reuses it on every page load.
export async function POST() {
  const pb = await ensureAdminAuth();
  const id = randomUUID();
  await pb.collection('carts').create({ cart_id: id });
  return NextResponse.json({ cartId: id }, { headers: { 'Cache-Control': 'no-store' } });
}
