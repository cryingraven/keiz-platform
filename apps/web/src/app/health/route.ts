import { NextResponse } from 'next/server';

/** Liveness probe for the web container. The API lives at /api/health. */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: 'keiz-web',
      time: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
