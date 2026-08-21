import { NextResponse } from 'next/server';
import { getReports } from '@/lib/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const venueId = Number(url.searchParams.get('venue') ?? 1);
    const reports = await getReports(venueId);
    return NextResponse.json({ ok: true, ...reports });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
