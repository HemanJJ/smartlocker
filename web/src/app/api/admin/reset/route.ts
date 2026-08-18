import { NextResponse } from 'next/server';
import { clearAllOrders } from '@/lib/stringing';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await clearAllOrders();
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[AdminReset] 錯誤:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
