import { NextResponse } from 'next/server';
import { listPriceTiers, upsertPriceTier, deletePriceTier } from '@/lib/stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 量價階梯（後台動態設定；kiosk 不顯示）

export async function GET() {
  try {
    const tiers = await listPriceTiers();
    return NextResponse.json({ ok: true, tiers });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await upsertPriceTier({
      sku: String(body.sku ?? '').trim(),
      minQty: Number(body.minQty ?? 0),
      tierType: body.tierType === 'unit_price' ? 'unit_price' : 'percent',
      percent: body.percent != null ? Number(body.percent) : undefined,
      unitPrice: body.unitPrice != null ? Number(body.unitPrice) : undefined,
      applyTo: body.applyTo ?? 'single',
      category: body.category ? String(body.category) : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    await deletePriceTier(Number(body.id ?? 0));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
