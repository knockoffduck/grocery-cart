// Data Access Layer: a single, well-typed way to ask "who is the
// current user?" from server components, server actions, and route
// handlers. `cache()` keeps the per-render hit to one PocketBase call
// even if many components ask in the same request.

import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { forbidden, unauthorized } from 'next/navigation';
import { getUserFromToken } from '@/lib/auth';

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin' | null;
};

const PB_TOKEN_COOKIE = 'pb_token';

/**
 * Returns the current user from the session cookie, or `null` if no
 * valid session is present. Never redirects; use this when you want
 * to *render* different UI for signed-in vs anonymous users.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(PB_TOKEN_COOKIE)?.value;
  if (!token) return null;

  const user = await getUserFromToken(token);
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
});

/** True iff there is a signed-in user. */
export const isSignedIn = cache(async (): Promise<boolean> => {
  return (await getCurrentUser()) !== null;
});

/**
 * Throws (renders) the `unauthorized.tsx` page (401) if no user is
 * signed in. Returns the user otherwise.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) unauthorized();
  return user;
}

/**
 * Throws `unauthorized.tsx` (401) if no session, or `forbidden.tsx`
 * (403) if the user is not an admin.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== 'admin') forbidden();
  return user;
}
