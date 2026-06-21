import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const dynamic = 'force-dynamic';

// GET /api/cert
// Serves the self-signed root CA cert as a downloadable file. iOS users
// install it via Settings > Profile Downloaded, then enable trust under
// Settings > General > About > Certificate Trust Settings.
export async function GET() {
  const certPath = process.env.TLS_CERT || resolve(process.cwd(), 'certs/cert.pem');
  if (!existsSync(certPath)) {
    return NextResponse.json({ error: 'cert not found; run `npm run https:gen`' }, { status: 404 });
  }
  const body = readFileSync(certPath);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'inline; filename="homelab-root-ca.crt"',
    },
  });
}
