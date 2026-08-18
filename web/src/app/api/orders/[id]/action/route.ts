import { NextRequest, NextResponse } from 'next/server';
import { transitionOrder } from '@/lib/stringing';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const order = await transitionOrder(Number(id), String(body.action || ''));
    return NextResponse.json({ ok: true, order });
  } catch (err: any) {
    console.error('[OrderAction] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
