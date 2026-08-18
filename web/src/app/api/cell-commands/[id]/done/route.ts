import { NextRequest, NextResponse } from 'next/server';
import { markCellCommandDone } from '@/lib/stringing';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ok = await markCellCommandDone(Number(id));
    return NextResponse.json({ ok });
  } catch (err: any) {
    console.error('[CellCommandDone] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
