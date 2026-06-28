// Match Open Food Facts EANs to Aldi products.
// Run: npm run match
//
// Manual matches in `manual_matches` are NEVER touched. EANs in that
// table are excluded from the fuzzy re-match, and existing
// ean_to_aldi rows for those EANs are preserved.
//
// Thin CLI wrapper around the reusable runner in src/lib/match-runner.ts.

import { runMatch } from '../src/lib/match-runner.js';

runMatch()
  .then((r) => {
    console.log(`[match] CLI exit: ${r.matches} matches in ${(r.elapsedMs / 1000).toFixed(1)}s, ${r.preservedManual} manual preserved`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('[match] CLI FAILED:', e);
    process.exit(1);
  });
