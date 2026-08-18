import { NextRequest, NextResponse } from 'next/server';
import { listOrders, listMineOrders, createOrder, type OrderStatus } from '@/lib/stringing';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const lineUserId = request.nextUrl.searchParams.get('lineUserId');
    const status = request.nextUrl.searchParams.get('status') as OrderStatus | null;

    // 客人查自己的訂單（LIFF 用）
    if (lineUserId) {
      const orders = await listMineOrders(lineUserId);
      return NextResponse.json({ ok: true, orders });
    }

    // 員工後台全列表（可依狀態篩選）
    const orders = await listOrders(status || undefined);
    return NextResponse.json({ ok: true, orders });
  } catch (err: any) {
    console.error('[Orders] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const order = await createOrder({
      stringId: Number(body.stringId),
      tension: Number(body.tension),
      lineUserId: body.lineUserId || '',
      customerName: body.customerName || '',
      note: body.note || '',
    });
    return NextResponse.json({ ok: true, order });
  } catch (err: any) {
    console.error('[Orders] 建立失敗:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
