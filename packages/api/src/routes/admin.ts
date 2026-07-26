import { Hono } from 'hono';
import { ensureAdminAuth, getMeta } from '../lib/pb';
import { getSyncProgress, runAldiSync } from '../lib/sync-runner';
import { requireAdmin } from '../middleware/auth';

const admin = new Hono();

// All admin routes require admin auth
admin.use('*', requireAdmin);

// GET /api/admin/sync/status
// Returns the latest sync progress. Used by the admin page's polling
// client component.
admin.get('/admin/sync/status', async (c) => {
  const pb = await ensureAdminAuth();
  const progress = await getSyncProgress();

  const [aldiRes, eanRes, manualRes] = await Promise.all([
    pb.collection('aldi_products').getList(1, 1, { fields: 'id' }),
    pb.collection('ean_to_aldi').getList(1, 1, { fields: 'id' }),
    pb.collection('manual_matches').getList(1, 1, { fields: 'id' }),
  ]);

  return c.json({
    progress,
    counts: {
      aldi_products: aldiRes.totalItems,
      ean_aldi_matches: eanRes.totalItems,
      manual_matches: manualRes.totalItems,
    },
    aldiLastSync: await getMeta('aldi_sync_completed_at'),
    matchLastRun: await getMeta('match_completed_at'),
    matchLastPreserved: await getMeta('match_preserved_manual'),
  }, 200, { 'Cache-Control': 'no-store' });
});

// POST /api/admin/sync/trigger
// Kicks off a background Aldi catalogue sync + OFF->Aldi match.
admin.post('/admin/sync/trigger', async (c) => {
  const progress = await getSyncProgress();
  if (progress.running) {
    return c.json({ error: 'sync already running' }, 409);
  }

  // Fire and forget — run in background
  runAldiSync().catch((err) => {
    console.error('[admin/sync] background sync failed:', err);
  });

  return c.json({ ok: true, message: 'sync started' });
});

export { admin as adminRoutes };
