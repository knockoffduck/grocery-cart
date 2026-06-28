// Next 16 proxy (formerly middleware.ts). Acts as the *optimistic*
// gate on the admin pages and admin API routes — if there's no session
// cookie, redirect to /login (pages) or 401 (api) before we even try
// to render. The DAL (`src/lib/dal.ts`) and the route handlers are
// the *secure* gate; this is just to short-circuit hot-path renders
// and avoid flashing forbidden UI on first paint.
//
// Per the Next 16 docs (01-app/03-api-reference/03-file-conventions/proxy.md):
//   - "Proxy is meant to be invoked separately of your render code...
//      you should not attempt relying on shared modules or globals."
//   - "Always verify authentication and authorization inside each
//     Server Function rather than relying on Proxy alone."
//
// So this file only reads the session cookie's *presence* (Better Auth
// signs the value; we don't need to decrypt it here).

import { NextResponse, type NextRequest } from 'next/server';

// Better Auth's default session cookie name. We set it via the
// `advanced.useSecureCookies` config; the name doesn't change between
// dev and prod, only the `Secure` flag.
const SESSION_COOKIE = 'better-auth.session_token';

const isAdminPath = (path: string) =>
  path === '/admin' || path.startsWith('/admin/');

const isAdminApiPath = (path: string) =>
  path === '/api/admin' || path.startsWith('/api/admin/');

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isAdminPath(pathname) && !isAdminApiPath(pathname)) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (hasSession) return NextResponse.next();

  // No session. For pages redirect to /login. For admin API return
  // 401 so fetch callers can handle it without a redirect.
  if (isAdminApiPath(pathname)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on /admin pages and /api/admin routes; skip everything else.
  // The negative lookahead below keeps auth routes, static assets,
  // and the service worker / manifest out of the proxy.
  matcher: [
    '/admin/:path*',
    '/api/admin/:path*',
  ],
};
