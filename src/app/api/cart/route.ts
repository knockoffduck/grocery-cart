import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/cart
// Create a new cart, returns the new cartId. The client stores it in
// localStorage and reuses it on every page load.
export async function POST() {
  const id = randomUUID();
  db.prepare('INSERT INTO carts (id) VALUES (?)').run(id);
  return NextResponse.json({ cartId: id });
}
