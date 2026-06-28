// Data Access Layer: a single, well-typed way to ask "who is the
// current user?" from server components, server actions, and route
// handlers. `cache()` keeps the per-render hit to one DB call even
// if many components ask in the same request.

import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { forbidden, unauthorized } from 'next/navigation';
import { auth } from '@/lib/auth';

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin' | null;
};

/**
 * Returns the current user from the session cookie, or `null` if no
 * valid session is present. Never redirects; use this when you want
 * to *render* different UI for signed-in vs anonymous users.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const u = session.user as typeof session.user & { role?: string | null };
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: (u.role as CurrentUser['role']) ?? null,
  };
});

/** True iff there is a signed-in user. Cheaper than `getCurrentUser`
 *  because it doesn't have to read every session field, but it still
 *  hits the DB. Use for conditional rendering only. */
export const isSignedIn = cache(async (): Promise<boolean> => {
  return (await getCurrentUser()) !== null;
});

/**
 * Throws (renders) the `unauthorized.tsx` page (401) if no user is
 * signed in. Returns the user otherwise. Use in admin pages and any
 * server-rendered route that requires a session.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) unauthorized();
  return user;
}

/**
 * Throws `unauthorized.tsx` (401) if no session, or `forbidden.tsx`
 * (403) if the user is not an admin. Use in any route/handler that
 * exposes admin functionality. The optimistic check in proxy.ts only
 * looks at the cookie; this DAL is the *secure* gate.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== 'admin') forbidden();
  return user;
}
