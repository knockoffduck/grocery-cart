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

import { createServer as createHttpServer, Server as HttpServer } from "node:http";
import { createServer as createHttpsServer, Server as HttpsServer } from "node:https";
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

let httpServer: HttpServer | null = null;
let httpsServer: HttpsServer | null = null;
let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`> received ${signal}, draining...`);

  const hardExit = setTimeout(() => {
    console.error('> shutdown timed out after 10s, forcing exit');
    process.exit(1);
  }, 10_000);
  hardExit.unref();

  let pending = 0;
  if (httpsServer) pending++;
  if (httpServer) pending++;

  const onClosed = () => {
    pending--;
    if (pending === 0) {
      console.log('> all servers closed, exiting cleanly');
      process.exit(0);
    }
  };

  if (httpsServer) {
    httpsServer.close((err) => {
      if (err) console.error('> https close error:', err);
      onClosed();
    });
  }
  if (httpServer) {
    httpServer.close((err) => {
      if (err) console.error('> http close error:', err);
      onClosed();
    });
  }

  if (pending === 0) {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('> uncaughtException:', err);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('> unhandledRejection:', reason);
  shutdown('unhandledRejection');
});

app.prepare()
  .then(() => {
    if (existsSync(CERT_PATH) && existsSync(KEY_PATH)) {
      try {
        const cert = readFileSync(CERT_PATH);
        const key = readFileSync(KEY_PATH);
        httpsServer = createHttpsServer({ cert, key }, (req, res) => handle(req, res));
        httpsServer.on('error', (err) => {
          console.error('> https server error:', err);
          shutdown('server-error');
        });
        httpsServer.listen(HTTPS_PORT, HOST, () => {
          console.log(`> HTTPS server ready on https://${HOST}:${HTTPS_PORT}`);
          console.log(`> On the LAN, visit https://192.168.68.55:${HTTPS_PORT}`);
        });
      } catch (err) {
        console.error(`> Failed to load certs at ${CERT_PATH} / ${KEY_PATH}:`, err);
        console.warn('> Skipping HTTPS; HTTP only. Run `npm run https:gen` to regenerate certs.');
        httpsServer = null;
      }
    } else {
      console.warn(`> No certs at ${CERT_PATH}; HTTPS not started. Run \`npm run https:gen\`.`);
    }

    // HTTP for local dev convenience (localhost is exempt from the iOS
    // camera-HTTPS rule, so http://localhost:3000 works on the same machine).
    httpServer = createHttpServer((req, res) => handle(req, res));
    httpServer.on('error', (err) => {
      console.error('> http server error:', err);
      shutdown('server-error');
    });
    httpServer.listen(HTTP_PORT, HOST, () => {
      console.log(`> HTTP server ready on http://${HOST}:${HTTP_PORT}`);
    });
  })
  .catch((err) => {
    console.error('> app.prepare() failed:', err);
    process.exit(1);
  });
