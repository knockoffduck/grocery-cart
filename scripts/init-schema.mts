// One-time schema init. Idempotent — safe to re-run.
import { sql, closeDb } from '../src/lib/db.js';

async function main() {
  // The schema bootstrap is fire-and-forget on module import, so wait
  // a moment for the CREATE TABLE statements to complete.
  await new Promise((r) => setTimeout(r, 1500));
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `;
  console.log('Tables:', tables.map((t) => t.table_name).join(', '));
}

main()
  .catch((e) => {
    console.error('Schema init failed:', e);
    process.exit(1);
  })
  .finally(() => closeDb());
