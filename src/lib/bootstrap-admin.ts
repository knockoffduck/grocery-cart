// Bootstrap admin seeding.
//
// Runs once per cold start as part of ensureSchema(). If ADMIN_EMAIL +
// ADMIN_PASSWORD are set and no user with that email exists, we
// create one and promote it to the 'admin' role. Idempotent.
//
// Called by src/lib/db.ts:ensureSchema() (which itself is called
// before any other query hits the DB). We deliberately use Better
// Auth's signUpEmail + internalAdapter.updateUserByEmail so the
// password gets hashed with Better Auth's hasher and the user
// lives in the same table as every other sign-up.

import { auth } from './auth.js';

let bootstrapPromise: Promise<void> | null = null;

export function ensureBootstrapAdmin(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = doBootstrap();
  return bootstrapPromise;
}

async function doBootstrap(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 8) {
    console.warn('[auth] ADMIN_PASSWORD must be at least 8 characters; skipping bootstrap admin');
    return;
  }

  // Everything below touches Better Auth's managed tables (user, session,
  // etc.). If the database is unreachable, migrations fail, or permissions
  // are missing, we log the error and move on — the bootstrap must never
  // reject the schema promise or every subsequent DB query will fail.
  try {
    const ctx = await auth.$context;
    const existing = await ctx.internalAdapter.findUserByEmail(email.toLowerCase());
    const existingRole = (existing as unknown as { role?: string | null } | null)?.role ?? null;
    if (existing) {
      if (existingRole !== 'admin') {
        await ctx.internalAdapter.updateUserByEmail(email.toLowerCase(), { role: 'admin' });
        console.log(`[auth] promoted existing user ${email} to admin`);
      }
      return;
    }

    const baseURL =
      process.env.BETTER_AUTH_URL ||
      process.env.NEXT_PUBLIC_BETTER_AUTH_URL ||
      'http://localhost:3000';
    const b = new Headers({ origin: baseURL });
    await auth.api.signUpEmail({
      body: { email: email.toLowerCase(), password, name: 'Admin' },
      headers: b,
    });

    await ctx.internalAdapter.updateUserByEmail(email.toLowerCase(), { role: 'admin' });
    console.log(`[auth] bootstrap admin created: ${email}`);
  } catch (e: any) {
    console.warn(`[auth] bootstrap admin skipped (non-fatal): ${e?.message ?? e}`);
  }
}
