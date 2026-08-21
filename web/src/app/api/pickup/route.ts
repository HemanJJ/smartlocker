import { NextRequest, NextResponse } from 'next/server';
import { pickupOrder } from '@/lib/stringing';

export const runtime = 'nodejs';

// POST /api/pickup  body: { code: '123456' }
// 客人取件：驗證取件碼 → 排入開格指令（kiosk 輪詢後送 RS-485 開鎖）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const order = await pickupOrder(body.code || '');
    return NextResponse.json({ ok: true, order, slotNo: order.currentSlot });
  } catch (err: any) {
    console.error('[Pickup] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
