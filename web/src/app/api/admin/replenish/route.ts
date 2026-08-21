import { NextResponse } from 'next/server';
import { getReplenishmentNeeds } from '@/lib/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 需求單：低於安全存量的商品＋建議補貨量
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const venueId = Number(url.searchParams.get('venue') ?? 1);
    const needs = await getReplenishmentNeeds(venueId);
    return NextResponse.json({ ok: true, needs });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
