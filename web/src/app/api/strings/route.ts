import { NextResponse } from 'next/server';
import { listStrings } from '@/lib/stringing';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const strings = await listStrings(true);
    return NextResponse.json({ ok: true, strings });
  } catch (err: any) {
    console.error('[Strings] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
