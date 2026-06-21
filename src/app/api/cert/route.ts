import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const dynamic = 'force-dynamic';

// GET /api/cert
//
// Serves the self-signed TLS cert as a downloadable .pem file. iOS users
// install it via Settings > Profile Downloaded, then enable trust under
// Settings > General > About > Certificate Trust Settings. Android users
// install via Settings > Security > Encryption & credentials > Install a
// certificate.
//
// The original Hono server exposed this at /cert with Content-Type
// application/x-pem-file and filename aldi-cart-cert.pem. We keep that
// shape so existing scripts and bookmarks still work.
export async function GET() {
  const certPath = process.env.TLS_CERT || resolve(process.cwd(), 'certs/cert.pem');
  if (!existsSync(certPath)) {
    return NextResponse.json({ error: 'cert not found; run `npm run https:gen`' }, { status: 404 });
  }
  const body = readFileSync(certPath);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-pem-file',
      'Content-Disposition': 'inline; filename="aldi-cart-cert.pem"',
    },
  });
}
