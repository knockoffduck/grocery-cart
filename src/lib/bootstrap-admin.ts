// Bootstrap admin seeding.
//
// Runs once per cold start. If ADMIN_EMAIL + ADMIN_PASSWORD are set and
// no user with that email exists, we create one and promote it to the
// 'admin' role. Idempotent.
//
// Called lazily on first server request. Uses the PocketBase admin
// client to manage users.

import { ensureAdminAuth } from './pb';

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

  try {
    const pb = await ensureAdminAuth();

    // Check if user already exists
    let existing: any = null;
    try {
      existing = await pb.collection('users').getFirstListItem(`email="${email.toLowerCase()}"`);
    } catch {
      // Not found — will create below
    }

    if (existing) {
      if (existing.role !== 'admin') {
        await pb.collection('users').update(existing.id, { role: 'admin' });
        console.log(`[auth] promoted existing user ${email} to admin`);
      }
      return;
    }

    // Create new admin user
    await pb.collection('users').create({
      email: email.toLowerCase(),
      password,
      passwordConfirm: password,
      name: 'Admin',
      role: 'admin',
    });
    console.log(`[auth] bootstrap admin created: ${email}`);
  } catch (e: any) {
    console.warn(`[auth] bootstrap admin skipped (non-fatal): ${e?.message ?? e}`);
  }
}
