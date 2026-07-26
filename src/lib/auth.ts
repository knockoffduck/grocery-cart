// PocketBase auth helpers.
//
// Replaces Better Auth. Provides:
//   - authenticateAdmin(): returns admin-authenticated PocketBase client
//   - getUserFromToken(token): validates a user JWT and returns user info
//
// The actual PocketBase client lives in src/lib/pb.ts. This module
// adds auth-specific helpers used by the DAL and server actions.

import PocketBase from 'pocketbase';
import { PB_URL, ensureAdminAuth, getClientForToken } from './pb';

export type PBUser = {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin' | null;
};

/**
 * Returns an admin-authenticated PocketBase client.
 * Delegates to ensureAdminAuth() in pb.ts.
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
    // authRefresh validates the token and returns the current user
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
