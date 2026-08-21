import { NextResponse } from 'next/server';
import { createStocktake } from '@/lib/stock';
import { listCatalog } from '@/lib/vending';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const venueId = Number(url.searchParams.get('venue') ?? 1);
    const catalog = await listCatalog(venueId);
    return NextResponse.json({ ok: true, catalog });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await createStocktake({
      venueId: body.venueId ? Number(body.venueId) : 1,
      note: String(body.note ?? ''),
      items: (body.items ?? []).map((i: any) => ({
        sku: String(i.sku ?? ''),
        name: String(i.name ?? ''),
        actualQty: Number(i.actualQty ?? 0),
      })),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
