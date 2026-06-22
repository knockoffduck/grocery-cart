import { NextResponse } from 'next/server';
const MAX_BYTES = 4 * 1024; // 4 KB
export function checkBodySize(request: Request): NextResponse | null {
  const len = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (len > MAX_BYTES) {
    return NextResponse.json(
      { error: 'request body too large', max_bytes: MAX_BYTES },
      { status: 413 },
    );
  }
  return null;
}
