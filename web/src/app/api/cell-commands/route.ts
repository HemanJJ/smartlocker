import { NextRequest, NextResponse } from 'next/server';
import { listCellCommands, queueOpenCell } from '@/lib/stringing';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status');
    const commands = await listCellCommands(status === 'done' ? 'done' : 'pending');
    return NextResponse.json({ ok: true, commands });
  } catch (err: any) {
    console.error('[CellCommands] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const slotNo = Number(body.slotNo);
    if (!Number.isInteger(slotNo) || slotNo < 1) {
      return NextResponse.json({ ok: false, error: '格號無效' }, { status: 400 });
    }
    await queueOpenCell(slotNo);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[CellCommands] 排入失敗:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
