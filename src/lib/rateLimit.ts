// Simple in-memory token bucket. Good enough for a single-replica app;
// swap for Redis-backed if you ever scale.
interface Bucket { tokens: number; lastRefill: number; }
const buckets = new Map<string, Bucket>();
export function rateLimit(
  key: string,
  options: { capacity: number; refillPerSec: number },
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: options.capacity, lastRefill: now };
  const elapsedSec = (now - bucket.lastRefill) / 1000;
  const refilled = Math.min(
    options.capacity,
    bucket.tokens + elapsedSec * options.refillPerSec,
  );
  if (refilled < 1) {
    buckets.set(key, { tokens: refilled, lastRefill: now });
    return { allowed: false, retryAfterMs: Math.ceil((1 - refilled) / options.refillPerSec * 1000) };
  }
  buckets.set(key, { tokens: refilled - 1, lastRefill: now });
  return { allowed: true, retryAfterMs: 0 };
}
