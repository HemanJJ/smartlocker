import { NextRequest, NextResponse } from 'next/server';
import { listCustomerOrders } from '@/lib/stringing';

export const runtime = 'nodejs';

// GET /api/customers/orders?phone=09xx 或 ?lineUserId=Uxxx → 該會員最近消費紀錄
export async function GET(request: NextRequest) {
  try {
    const phone = request.nextUrl.searchParams.get('phone') || '';
    const lineUserId = request.nextUrl.searchParams.get('lineUserId') || '';
    const orders = await listCustomerOrders({ phone, lineUserId });
    return NextResponse.json({ ok: true, orders });
  } catch (err: any) {
    console.error('[Customers] 消費紀錄失敗:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
