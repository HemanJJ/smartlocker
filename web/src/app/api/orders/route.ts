import { NextRequest, NextResponse } from 'next/server';
import { getUserOrders } from '@/lib/pickup-code';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const lineUserId = request.nextUrl.searchParams.get('lineUserId');
  if (!lineUserId) {
    return NextResponse.json({ ok: false, error: 'missing_lineUserId' }, { status: 400 });
  }

  const orders = await getUserOrders(lineUserId);
  const mapped = orders.map((o) => ({
    code: o.code,
    cell: o.cell,
    venue: o.venue,
    status: o.status,
    expiry: new Date(o.expiryAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    createdAt: new Date(o.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    bookingDate: o.bookingDate,
    timeSlot: o.timeSlot,
    price: o.price,
  }));

  return NextResponse.json({ ok: true, orders: mapped });
}
