import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `output: "standalone"` is intentionally NOT enabled. The standalone
  // trace doesn't include `next/dist/compiled/webpack/*` when the build
  // is run with `--webpack`, so a standalone-traced custom server crashes
  // at startup with `Cannot find module 'webpack'`. We ship the full
  // production node_modules instead (~150 MB runtime cost). When Turbopack
  // gains standalone-output support we can revisit.

  // Resolve `import './foo.js'` -> `./foo.ts` so the same source can be
  // consumed by the Next.js webpack build AND by the tsx CLI scripts
  // (which run as ESM and require the explicit extension).
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },

  // Allow the LAN IP to request dev resources. Without this, the iPhone
  // sees the static HTML (because it loads over HTTPS) but the JS chunks
  // get blocked at the cross-origin boundary, and the page never hydrates
  // — the UI "displays correctly but I can't tap on anything."
  // Production builds don't need this; it's dev-server-only.
  allowedDevOrigins: [
    "192.168.68.55",
    "localhost",
    "127.0.0.1",
    "192.168.68.55:7778",
    "localhost:7778",
  ],

  // Security headers. CSP is intentionally NOT set — getUserMedia + WASM
  // loading from the same origin + cross-origin image fetches from Aldi's
  // CDN make a locked-down CSP brittle. The headers below are the cheap
  // wins.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The PWA only needs camera (scanner) and geolocation (optional).
          // Disable everything else to reduce the browser attack surface.
          // CSP is intentionally omitted — see README for rationale.
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), midi=()" },
          // The PWA is a single-page app; HSTS is only useful if we're
          // committed to HTTPS. Dokploy terminates TLS in front of the
          // container via Traefik, so HSTS at the app layer is redundant
          // — Traefik sets it on the public listener.
        ],
      },
      // Service worker specific headers (per the Next 16 PWA guide).
      // A locked-down CSP here is fine — the SW does not need
      // getUserMedia / cross-origin fetches.
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
