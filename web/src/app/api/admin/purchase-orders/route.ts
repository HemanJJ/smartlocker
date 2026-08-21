import { NextResponse } from 'next/server';
import { createPurchaseOrder, listPurchaseOrders, listLowStock } from '@/lib/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const venueId = Number(url.searchParams.get('venue') ?? 1);
    const orders = await listPurchaseOrders(venueId);
    const lowStock = await listLowStock(venueId);
    return NextResponse.json({ ok: true, orders, lowStock });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await createPurchaseOrder({
      venueId: body.venueId ? Number(body.venueId) : 1,
      supplierId: Number(body.supplierId ?? 0),
      note: String(body.note ?? ''),
      items: (body.items ?? []).map((i: any) => ({
        sku: String(i.sku ?? ''),
        name: String(i.name ?? ''),
        qty: Number(i.qty ?? 0),
        unitCost: Number(i.unitCost ?? 0),
      })),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
