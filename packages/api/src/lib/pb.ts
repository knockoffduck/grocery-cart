// PocketBase client module.
//
// Provides:
//   - getAdminClient(): admin-authenticated PocketBase instance for server ops
//   - getClientForToken(token): user-scoped client for per-request auth
//   - getMeta(key) / setMeta(key, value): metadata helpers

import PocketBase from 'pocketbase';

export const PB_URL = process.env.POCKETBASE_URL || 'https://pb.dvcklab.com';

let _adminClient: PocketBase | null = null;
let _adminAuthPromise: Promise<void> | null = null;

/**
 * Returns an admin-authenticated PocketBase client. Authenticates lazily
 * on first call; subsequent calls reuse the same instance (token auto-refreshes).
 */
export function getAdminClient(): PocketBase {
  if (!_adminClient) {
    _adminClient = new PocketBase(PB_URL);
    _adminClient.autoCancellation(false);
  }
  return _adminClient;
}

/**
 * Ensures the admin client is authenticated. Call this before any admin
 * operation. Safe to call multiple times — only authenticates once.
 */
export async function ensureAdminAuth(): Promise<PocketBase> {
  const pb = getAdminClient();
  if (pb.authStore.isValid) return pb;

  if (!_adminAuthPromise) {
    _adminAuthPromise = (async () => {
      const email = process.env.POCKETBASE_ADMIN_EMAIL;
      const password = process.env.POCKETBASE_ADMIN_PASSWORD;
      if (!email || !password) {
        throw new Error('POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD are required');
      }
      await pb.collection('_superusers').authWithPassword(email, password);
    })();
    _adminAuthPromise.catch(() => { _adminAuthPromise = null; });
  }
  await _adminAuthPromise;
  return pb;
}

/**
 * Returns a PocketBase client authenticated with a user's JWT token.
 */
export function getClientForToken(token: string): PocketBase {
  const pb = new PocketBase(PB_URL);
  pb.authStore.save(token);
  return pb;
}

/**
 * Returns a plain (unauthenticated) PocketBase client.
 */
export function getPublicClient(): PocketBase {
  return new PocketBase(PB_URL);
}

// ----- Meta helpers -----

/** Read a metadata key. Returns the value or undefined. */
export async function getMeta(key: string): Promise<string | undefined> {
  const pb = await ensureAdminAuth();
  try {
    const record = await pb.collection('meta').getFirstListItem(`key="${key}"`);
    return record.value as string;
  } catch {
    return undefined;
  }
}

/** Upsert a metadata key. */
export async function setMeta(key: string, value: string): Promise<void> {
  const pb = await ensureAdminAuth();
  try {
    const existing = await pb.collection('meta').getFirstListItem(`key="${key}"`);
    await pb.collection('meta').update(existing.id, { value, updated_at: new Date().toISOString() });
  } catch {
    await pb.collection('meta').create({ key, value, updated_at: new Date().toISOString() });
  }
}
