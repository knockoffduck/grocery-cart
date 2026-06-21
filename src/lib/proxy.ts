// Webshare proxy pool with round-robin rotation and transparent direct fallback.
// Reads proxies from ./proxies.json (format: ip:port:user:pass) and rotates per request.
// Set ALDI_PROXY=off to force direct connection.

import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

type ProxyEntry = { ip: string; port: number; user: string; pass: string; url: string };

let POOL: ProxyEntry[] = [];
let cursor = 0;
let disable = process.env.ALDI_PROXY === 'off';

// Pool sources, tried in order:
//   1. PROXY_URL env (Webshare rotating endpoint, e.g. http://user:pass@p.webshare.io:80)
//   2. proxies.json next to cwd
//   3. Revo-Tracker's proxies.json (static IP list, often stale)
function buildPool(): ProxyEntry[] {
  // 1. Rotating endpoint from env
  const envUrl = process.env.PROXY_URL;
  if (envUrl) {
    try {
      const u = new URL(envUrl);
      const auth = u.username ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}` : null;
      return [{
        ip: u.hostname,
        port: parseInt(u.port || '80', 10),
        user: auth?.split(':')[0] ?? '',
        pass: auth?.split(':')[1] ?? '',
        url: envUrl,
      }];
    } catch (e) {
      console.warn(`[proxy] PROXY_URL env invalid: ${(e as Error).message}`);
    }
  }

  // 2 & 3. Static lists
  const candidates = [
    resolve(process.cwd(), 'proxies.json'),
    resolve(process.cwd(), '../Revo-Tracker/Revo-Tracker-API/Scraper/proxies.json'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const lines = readFileSync(path, 'utf-8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('[') && !l.startsWith(']') && !l.startsWith(','));
      const pool = lines.map((line): ProxyEntry => {
        const [ip, port, user, pass] = line.split(':');
        return {
          ip,
          port: parseInt(port, 10),
          user,
          pass,
          url: `http://${user}:${pass}@${ip}:${port}`,
        };
      });
      if (pool.length) {
        console.log(`[proxy] loaded ${pool.length} static proxies from ${path}`);
        return pool;
      }
    } catch (e) {
      console.warn(`[proxy] failed to read ${path}: ${(e as Error).message}`);
    }
  }
  return [];
}

if (!disable) {
  POOL = buildPool();
  if (POOL.length === 0) {
    console.warn('[proxy] no proxies available; falling back to direct connection');
    disable = true;
  } else {
    console.log(`[proxy] pool ready: ${POOL.length} entries`);
  }
}

// Lazy-initialized dispatchers (undici's ProxyAgent is per-target)
const dispatcherCache = new Map<string, ProxyAgent>();
function getDispatcher(url: string): ProxyAgent {
  let d = dispatcherCache.get(url);
  if (!d) {
    d = new ProxyAgent({ uri: url });
    dispatcherCache.set(url, d);
  }
  return d;
}

// Round-robin index with per-host sharding so we don't burn through IPs faster than needed
const hostCounters = new Map<string, number>();
function nextProxy(host: string): ProxyEntry | null {
  if (disable || POOL.length === 0) return null;
  const i = (hostCounters.get(host) ?? 0) % POOL.length;
  hostCounters.set(host, i + 1);
  return POOL[i];
}

export function setProxyEnabled(enabled: boolean) {
  disable = !enabled;
}

/**
 * Fetch with proxy pool. Strategy:
 *   1. Round-robin pick a proxy.
 *   2. Try it. If the request fails (network) or returns 429/502/503, try the next proxy.
 *   3. After N proxies fail, fall back to direct connection.
 *
 * Rationale: OFF blocks specific exit IPs (not a sliding rate limit), and
 * the Webshare rotating endpoint gives a different IP per call but each IP
 * has its own block status. For a pool size of 1 (single rotating endpoint),
 * we use `maxProxyRetries` to request multiple fresh IPs before giving up.
 */
export async function proxyFetch(
  url: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal; maxProxyRetries?: number; allowDirect?: boolean } = {},
): Promise<Response> {
  const u = new URL(url);
  const allowDirect = opts.allowDirect ?? true;
  const headers = opts.headers;

  // undici and the global fetch return nominally different Response types but
  // they're runtime-compatible. Cast on entry/exit to keep call sites clean.
  const fetchDirect = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) =>
    undiciFetch(input, init) as unknown as Promise<Response>;

  if (disable) return fetchDirect(url, { headers, signal: opts.signal });

  const maxRetries = opts.maxProxyRetries ?? 5;
  const tried = new Set<number>();
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // For a single-entry rotating pool, we want to call it `maxRetries` times
    // (each call gets a fresh exit IP). For a multi-entry pool, we visit
    // distinct entries, then stop. The cursor advances either way.
    if (tried.size >= POOL.length && POOL.length > 1) break;
    const i = (hostCounters.get(u.host) ?? 0) % POOL.length;
    hostCounters.set(u.host, i + 1);
    if (POOL.length > 1 && tried.has(i)) continue;
    tried.add(i);

    const proxy = POOL[i];
    try {
      const res = (await undiciFetch(url, {
        dispatcher: getDispatcher(proxy.url) as Dispatcher,
        headers,
        signal: opts.signal,
      })) as unknown as Response;
      if (await looksLikeRateLimit(res)) {
        lastErr = new Error(`rate-limited via ${proxy.ip}:${proxy.port} (status ${res.status})`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  if (allowDirect) {
    console.warn(`[proxy] all ${tried.size} proxy tries failed for ${u.host}; falling back to direct. last=${(lastErr as Error)?.message}`);
    return fetchDirect(url, { headers, signal: opts.signal });
  }
  throw lastErr ?? new Error('all proxies failed and direct fallback disabled');
}

async function looksLikeRateLimit(res: Response): Promise<boolean> {
  if (res.status === 429 || res.status === 502 || res.status === 503) return true;
  // OFF serves ban pages as 200 + HTML when it rate-limits anonymous traffic.
  // For an API call expecting JSON, an HTML body is a strong signal of the ban page.
  if (res.status === 200) {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) return true;
  }
  return false;
}

export function poolSize() {
  return POOL.length;
}
