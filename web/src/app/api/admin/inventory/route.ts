import { NextResponse } from 'next/server';
import { listAllInventory, upsertInventory } from '@/lib/vending';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 後台：庫存管理（middleware 已擋未登入）

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const venueId = Number(url.searchParams.get('venue') ?? 1);
    const items = await listAllInventory(venueId);
    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    console.error('[AdminInventory] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await upsertInventory({
      sku: String(body.sku ?? '').trim(),
      name: String(body.name ?? '').trim(),
      category: body.category ?? 'other',
      price: Number(body.price ?? 0),
      costPrice: Number(body.costPrice ?? 0),
      minQty: Number(body.minQty ?? 0),
      qty: Number(body.qty ?? 0),
      status: body.status ?? 'on_shelf',
      cabinetId: body.cabinetId ?? 'df-f',
      slotNo: Number(body.slotNo ?? 0),
      expiryDate: body.expiryDate || null,
    }, Number(body.venueId ?? 1));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[AdminInventory] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
