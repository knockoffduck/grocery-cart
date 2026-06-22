import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `output: "standalone"` is intentionally NOT enabled. The standalone
  // trace doesn't include `next/dist/compiled/webpack/*` when the build
  // is run with `--webpack`, so a standalone-traced custom server crashes
  // at startup with `Cannot find module 'webpack'`. We ship the full
  // production node_modules instead (~150 MB runtime cost). When Turbopack
  // gains standalone-output support we can revisit.

  // Allow the LAN IP to request dev resources. Without this, the iPhone
  // sees the static HTML (because it loads over HTTPS) but the JS chunks
  // get blocked at the cross-origin boundary, and the page never hydrates
  // — the UI "displays correctly but I can't tap on anything."
  // Production builds don't need this; it's dev-server-only.
  allowedDevOrigins: ["192.168.68.55", "localhost", "127.0.0.1"],

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
          // The PWA is a single-page app; HSTS is only useful if we're
          // committed to HTTPS. Dokploy terminates TLS in front of the
          // container via Traefik, so HSTS at the app layer is redundant
          // — Traefik sets it on the public listener.
        ],
      },
    ];
  },
};

export default nextConfig;
