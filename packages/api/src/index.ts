import app from './app';

const port = parseInt(process.env.API_PORT || '3001', 10);

console.log(`[api] listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
  // TLS for dev (iOS camera requires HTTPS on LAN)
  ...(process.env.TLS_CERT && process.env.TLS_KEY
    ? { tls: { cert: Bun.file(process.env.TLS_CERT), key: Bun.file(process.env.TLS_KEY) } }
    : {}),
};
