import { Hono } from 'hono';
import { getMeta } from '../lib/pb';

const refresh = new Hono();

// GET /api/refresh
// Returns the last-sync metadata. The actual re-sync is triggered by running
// `bun run sync:all` from the terminal on the server.
refresh.get('/refresh', async (c) => {
  return c.json({
    ok: true,
    hint: 'Run `bun run sync:all` from the server terminal to refresh the catalogue.',
    lastSync: {
      aldi: await getMeta('aldi_sync_completed_at'),
      off: await getMeta('off_sync_completed_at'),
      match: await getMeta('match_completed_at'),
    },
  });
});

export { refresh as refreshRoutes };
