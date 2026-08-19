import { NextRequest, NextResponse } from 'next/server';
import { getOrderById } from '@/lib/stringing';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const order = await getOrderById(Number(id));
    if (!order) return NextResponse.json({ ok: false, error: '訂單不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, order });
  } catch (err: any) {
    console.error('[OrderGet] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
