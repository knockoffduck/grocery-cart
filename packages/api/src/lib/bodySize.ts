import type { Context } from 'hono';

const MAX_BYTES = 4 * 1024; // 4 KB

/**
 * Check request body size. Returns an error response if too large,
 * or null if the request is acceptable.
 */
export function checkBodySize(c: Context): Response | null {
  const len = parseInt(c.req.header('content-length') ?? '0', 10);
  if (len > MAX_BYTES) {
    return c.json(
      { error: 'request body too large', max_bytes: MAX_BYTES },
      413,
    );
  }
  return null;
}
