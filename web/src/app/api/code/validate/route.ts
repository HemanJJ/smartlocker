import { NextRequest, NextResponse } from 'next/server';
import { validateCode } from '@/lib/pickup-code';
import { getVenueBySlug } from '@/lib/venues';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const venueSlug = request.nextUrl.searchParams.get('venue');
  if (!code || code.length !== 6) {
    return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 400 });
  }

  // 解析分店（選用；kiosk 一定要帶 venue）
  let venueId: number | undefined;
  if (venueSlug) {
    const v = await getVenueBySlug(venueSlug);
    if (!v) return NextResponse.json({ ok: false, error: 'venue_not_found' }, { status: 400 });
    venueId = v.id;
  }

  const cell = await validateCode(code, venueId);

  if (cell === -1) {
    return NextResponse.json({ ok: false, error: 'not_found_or_expired', cell: -1 });
  }
  if (cell === -2) {
    return NextResponse.json({ ok: false, error: 'already_used', cell: -2 });
  }

  return NextResponse.json({ ok: true, cell, code });
}
