import { NextRequest, NextResponse } from 'next/server';
import { markUsed } from '@/lib/pickup-code';
import { getVenueBySlug } from '@/lib/venues';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const code = body.code as string;
    const venueSlug = body.venue as string;
    if (!code) {
      return NextResponse.json({ ok: false, error: 'missing_code' }, { status: 400 });
    }

    let venueId: number | undefined;
    if (venueSlug) {
      const v = await getVenueBySlug(venueSlug);
      if (v) venueId = v.id;
    }

    const ok = await markUsed(code, venueId);
    return NextResponse.json({ ok });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
