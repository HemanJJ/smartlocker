import { NextResponse } from 'next/server';
import { createTransfer, listTransfers } from '@/lib/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 配貨到店：總倉 → 店家（內部移動，庫存一減一加）

export async function GET() {
  try {
    const transfers = await listTransfers();
    return NextResponse.json({ ok: true, transfers });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await createTransfer({
      fromVenueId: Number(body.fromVenueId ?? 1),
      toVenueId: Number(body.toVenueId ?? 0),
      note: String(body.note ?? ''),
      items: (body.items ?? []).map((i: any) => ({
        sku: String(i.sku ?? ''),
        name: String(i.name ?? ''),
        qty: Number(i.qty ?? 0),
      })),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
