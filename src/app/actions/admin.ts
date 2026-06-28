'use server';

// Admin-gated Server Actions. Each action calls `requireAdmin()` from
// the DAL so the optimistic proxy check + the secure DB-backed role
// check both run, per the Next 16 auth guide.

import { requireAdmin } from '@/lib/dal';
import { runAldiSync, getSyncProgress } from '@/lib/sync-runner';

export type TriggerResult = {
  ok: boolean;
  message: string;
};

/**
 * Kick off a full Aldi catalogue sync + match pass in the background.
 * Returns immediately. The admin UI polls /api/admin/sync/status.
 */
export async function triggerAldiSync(): Promise<TriggerResult> {
  await requireAdmin();

  // Reject if a sync is already running. We could queue them, but
  // it's simpler to require the admin to wait for the current run.
  const status = await getSyncProgress();
  if (status.status === 'running') {
    return {
      ok: false,
      message: 'A sync is already running. Wait for it to finish.',
    };
  }

  // Fire-and-forget. The Node process outlives the request and the
  // `void` ensures the promise rejection is observable from
  // unhandledRejection logging in server.ts.
  void runAldiSync({ log: (m) => console.log(`[admin-sync] ${m}`) }).catch(
    (e) => console.error('[admin-sync] background sync crashed:', e),
  );

  return { ok: true, message: 'Sync started. This page will update as it runs.' };
}
