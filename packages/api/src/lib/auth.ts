// PocketBase auth helpers for the Hono API.

import PocketBase from 'pocketbase';
import { PB_URL, ensureAdminAuth, getClientForToken } from './pb';
import type { CurrentUser } from '@aldi-cart/shared';

export type PBUser = CurrentUser;

/**
 * Returns an admin-authenticated PocketBase client.
 */
export async function authenticateAdmin(): Promise<PocketBase> {
  return ensureAdminAuth();
}

/**
 * Validates a user's JWT token against PocketBase and returns user info.
 * Returns null if the token is invalid or expired.
 */
export async function getUserFromToken(token: string): Promise<PBUser | null> {
  if (!token) return null;
  try {
    const pb = getClientForToken(token);
    const result = await pb.collection('users').authRefresh();
    const u = result.record;
    return {
      id: u.id,
      email: u.email,
      name: (u as any).name ?? null,
      role: (u as any).role ?? null,
    };
  } catch {
    return null;
  }
}

export { PB_URL };
