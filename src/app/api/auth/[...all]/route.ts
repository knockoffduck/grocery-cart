// Better Auth catch-all route. All /api/auth/* requests (sign-up,
// sign-in, sign-out, get-session, admin/* plugin routes) are handled
// by `auth.handler`. Next 16 requires async params even on catch-all
// routes, so we `await` ctx.params even though we don't use the value.

import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function handler(request: Request, ctx: { params: Promise<{ all: string[] }> }) {
  await ctx.params;
  return auth.handler(request);
}

export const GET = handler;
export const POST = handler;
