import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the LAN IP to request dev resources. Without this, the iPhone
  // sees the static HTML (because it loads over HTTPS) but the JS chunks
  // get blocked at the cross-origin boundary, and the page never hydrates
  // — the UI "displays correctly but I can't tap on anything."
  // Production builds don't need this; it's dev-server-only.
  allowedDevOrigins: ["192.168.68.55", "localhost", "127.0.0.1"],
};

export default nextConfig;
