// Better Auth configuration.
//
// Two storage tiers share one Postgres database:
//   - The app's tables (src/lib/db.ts) use postgres.js for low-overhead
//     tagged-template queries in route handlers and the sync scripts.
//   - Better Auth manages its own user / session / account / verification
//     tables via a `pg` Pool. We deliberately keep these two clients
//     separate so each library can pick the connection shape that fits
//     its own call patterns (tagged templates vs parameterised SQL).
//
// The `auth` instance is created lazily via a Proxy. Building
// `next build` walks every import graph to discover routes, and
// instantiating the Better Auth stack eagerly (which connects to
// the database) would crash the build when DATABASE_URL is not
// available (CI, type-check, build image). The Proxy defers
// real construction until the first property access.

import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { Pool } from 'pg';

let _pool: Pool | null = null;
function getPool(): Pool {
  if (_pool) return _pool;
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required for Better Auth');
  }
  _pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Some managed Postgres providers require SSL with self-signed
    // certs. postgres.js handles this automatically; `pg` needs the
    // explicit flag.
    ssl: { rejectUnauthorized: false },
  });
  return _pool;
}

function buildAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    console.warn(
      '[auth] BETTER_AUTH_SECRET is not set; sessions will be signed with a random key (dev only)',
    );
  }

  // baseURL is used by Better Auth for cookie domains and callback URLs.
  // In production this MUST be the public URL (e.g. https://grocerycart.dvcklab.com).
  // The fallback chain: env var → NEXT_PUBLIC variant → hardcoded domain → localhost.
  const baseURL =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL ||
    'https://grocerycart.dvcklab.com' ||
    'http://localhost:3000';

  const trustedOrigins: string[] = [
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
    baseURL,
    'http://localhost:3000',
    'https://localhost:7778',
    'https://192.168.68.55:7778',
  ].filter((s): s is string => !!s);

  return betterAuth({
    database: getPool(),
    secret: secret || 'dev-insecure-secret-set-BETTER_AUTH_SECRET',
    baseURL,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      autoSignIn: true,
    },
    plugins: [
      admin({
        // Default role for self-signups. The bootstrap admin is bumped to
        // 'admin' by ensureBootstrapAdmin() in src/lib/db.ts.
        defaultRole: 'user',
        adminRoles: ['admin'],
      }),
    ],
    advanced: {
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
  });
}

type AuthInstance = ReturnType<typeof buildAuth>;

let _auth: AuthInstance | null = null;
function getAuth(): AuthInstance {
  if (!_auth) _auth = buildAuth();
  return _auth;
}

// A Proxy that constructs the real `auth` instance on first property
// access. Lets route handlers do `auth.handler(request)` while
// `next build` can import this module without hitting the DB.
export const auth = new Proxy({} as AuthInstance, {
  get(_t, prop) {
    return (getAuth() as any)[prop];
  },
}) as AuthInstance;

export type Session = AuthInstance['$Infer']['Session'];
