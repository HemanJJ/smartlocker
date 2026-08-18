import { NextRequest, NextResponse } from 'next/server';
import { markPrintJobDone } from '@/lib/stringing';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const done = await markPrintJobDone(Number(id));
    return NextResponse.json({ ok: done });
  } catch (err: any) {
    console.error('[PrintJobDone] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
