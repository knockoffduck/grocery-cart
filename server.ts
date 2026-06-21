// Custom Next.js server with HTTPS support.
//
// iOS Safari requires HTTPS for camera access. localhost is exempt, but the
// homelab LAN IP (192.168.68.55) is not — so when you scan from your phone,
// you have to hit https://192.168.68.55:7778 with a self-signed cert trusted
// on the device. See scripts/gen-https.sh for the cert-generation flow.
//
// Usage:
//   npm run dev:https      (development, this file via tsx)
//   npm run start:https    (production, requires `npm run build` first)
//
// Also serves /api/cert returning the CA cert so the user can install it.

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import next from "next";

const HTTP_PORT = parseInt(process.env.HTTP_PORT || "3000", 10);
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || "7778", 10);
const HOST = process.env.HOST || "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";

const CERT_PATH = resolve(process.cwd(), "certs/cert.pem");
const KEY_PATH = resolve(process.cwd(), "certs/key.pem");

const app = next({ dev, hostname: HOST, port: HTTPS_PORT });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  if (existsSync(CERT_PATH) && existsSync(KEY_PATH)) {
    const cert = readFileSync(CERT_PATH);
    const key = readFileSync(KEY_PATH);
    createHttpsServer({ cert, key }, (req, res) => handle(req, res))
      .listen(HTTPS_PORT, HOST, () => {
        console.log(`> HTTPS server ready on https://${HOST}:${HTTPS_PORT}`);
        console.log(`> On the LAN, visit https://192.168.68.55:${HTTPS_PORT}`);
      });
  } else {
    console.warn(`> No certs at ${CERT_PATH}; HTTPS not started. Run \`npm run https:gen\`.`);
  }

  // HTTP for local dev convenience (localhost is exempt from the iOS
  // camera-HTTPS rule, so http://localhost:3000 works on the same machine).
  createHttpServer((req, res) => handle(req, res))
    .listen(HTTP_PORT, HOST, () => {
      console.log(`> HTTP server ready on http://${HOST}:${HTTP_PORT}`);
    });
});
