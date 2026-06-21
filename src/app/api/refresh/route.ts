import { NextResponse } from 'next/server';
import { getMeta } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/refresh
// Returns the last-sync metadata. The actual re-sync is triggered by running
// `npm run sync:all` from the terminal on the server. The Hono version of
// this app spawned a detached child process, but in a Next.js dev/start
// process the working directory and stdio handling are too unpredictable
// to do that reliably — better to require a manual terminal invocation.
export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: 'Run `npm run sync:all` from the server terminal to refresh the catalogue.',
    lastSync: {
      aldi: getMeta('aldi_sync_completed_at'),
      off: getMeta('off_sync_completed_at'),
      match: getMeta('match_completed_at'),
    },
  });
}
