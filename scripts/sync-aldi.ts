// One-shot sync of the full Aldi catalogue into PocketBase.
// Run: npm run sync:aldi
// Idempotent: upserts rows in place using sku as unique key.
//
// Thin CLI wrapper around the reusable runner in src/lib/sync-runner.ts.

import { runAldiSync } from '../src/lib/sync-runner.js';

runAldiSync({ runMatchAfter: false })
  .then((r) => {
    console.log(`[aldi-sync] CLI exit: ${r.total} products in ${(r.elapsedMs / 1000).toFixed(1)}s`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('[aldi-sync] CLI FAILED:', e);
    process.exit(1);
  });
