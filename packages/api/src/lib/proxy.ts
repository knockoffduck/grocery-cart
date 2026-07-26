// Webshare proxy pool with round-robin rotation.
// Reads proxies from PROXY_URL env or ./proxies.json and rotates per request.
// Set ALDI_PROXY=off to force direct connection (dev only).

import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

type ProxyEntry = { ip: string; port: number; user: string; pass: string; url: string };

let POOL: ProxyEntry[] = [];
let disable = process.env.ALDI_PROXY === 'off';

function buildPool(): ProxyEntry[] {
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

const dispatcherCache = new Map<string, ProxyAgent>();
function getDispatcher(url: string): ProxyAgent {
  let d = dispatcherCache.get(url);
  if (!d) {
    d = new ProxyAgent({ uri: url });
    dispatcherCache.set(url, d);
  }
  return d;
}

const hostCounters = new Map<string, number>();

export function setProxyEnabled(enabled: boolean) {
  disable = !enabled;
}

export async function proxyFetch(
  url: string,
  opts: { headers?: Record<string, string>; signal?: AbortSignal; maxProxyRetries?: number; allowDirect?: boolean } = {},
): Promise<Response> {
  const u = new URL(url);
  const allowDirect = opts.allowDirect ?? false;
  const headers = opts.headers;

  const fetchDirect = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) =>
    undiciFetch(input, init) as unknown as Promise<Response>;

  if (disable) return fetchDirect(url, { headers, signal: opts.signal });

  const maxRetries = opts.maxProxyRetries ?? 5;
  const tried = new Set<number>();
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
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
    console.warn(`[proxy] all ${tried.size} proxy tries failed for ${u.host}; falling back to direct.`);
    return fetchDirect(url, { headers, signal: opts.signal });
  }
  throw lastErr ?? new Error(`all ${tried.size} proxies failed for ${u.host} (no direct fallback)`);
}

async function looksLikeRateLimit(res: Response): Promise<boolean> {
  if (res.status === 429 || res.status === 502 || res.status === 503) return true;
  if (res.status === 200) {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) return true;
  }
  return false;
}

export function poolSize() {
  return POOL.length;
}
