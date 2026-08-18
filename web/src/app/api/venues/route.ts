import { NextResponse } from 'next/server';
import { listVenues } from '@/lib/venues';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const venues = await listVenues(true);
    return NextResponse.json({ ok: true, venues });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
