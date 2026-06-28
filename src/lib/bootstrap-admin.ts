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

  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserByEmail(email.toLowerCase());
  // The admin plugin augments the user record with `role`; the core
  // type doesn't include it, so we cast.
  const existingRole = (existing as unknown as { role?: string | null } | null)?.role ?? null;
  if (existing) {
    // Make sure the existing user is in the admin role (idempotent
    // — if the operator changed ADMIN_EMAIL to point at an existing
    // user, this still works).
    if (existingRole !== 'admin') {
      await ctx.internalAdapter.updateUserByEmail(email.toLowerCase(), { role: 'admin' });
      console.log(`[auth] promoted existing user ${email} to admin`);
    }
    return;
  }

  // signUpEmail creates the user + hashes the password. We discard
  // the response — no session is wanted here. Headers is required
  // by the API shape but we never use the resulting Set-Cookie.
  // The Origin header is needed because Better Auth's CSRF middleware
  // rejects requests without a matching Origin/Referer.
  const baseURL =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL ||
    'http://localhost:3000';
  const b = new Headers({ origin: baseURL });
  try {
    await auth.api.signUpEmail({
      body: { email: email.toLowerCase(), password, name: 'Admin' },
      headers: b,
    });
  } catch (e: any) {
    console.error(`[auth] failed to create bootstrap admin: ${e?.message ?? e}`);
    return;
  }

  // Promote the freshly-created user to admin.
  await ctx.internalAdapter.updateUserByEmail(email.toLowerCase(), { role: 'admin' });
  console.log(`[auth] bootstrap admin created: ${email}`);
}
