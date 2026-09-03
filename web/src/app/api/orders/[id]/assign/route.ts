import { NextRequest, NextResponse } from 'next/server';
import { assignOrderString } from '@/lib/stringing';

export const runtime = 'nodejs';

// POST /api/orders/[id]/assign → 後台把預算單指派成具體線種+磅數
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const order = await assignOrderString(Number(id), Number(body.stringId), Number(body.tension));
    return NextResponse.json({ ok: true, order });
  } catch (err: any) {
    console.error('[OrderAssign] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
